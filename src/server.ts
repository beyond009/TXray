/**
 * Chat API server with SSE for conversational tx analysis.
 * Uses LangGraph agent with tool calling - LLM decides when to analyze.
 * POST /api/chat → SSE stream: progress events + message_end with response.
 * ERC-8004: /.well-known/agent-registration.json, /api/erc8004/reputation, /api/erc8004/feedback-tx
 * x402: optional payment gate for /api/chat when X402_PAY_TO is set
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { paymentMiddleware } from 'x402-express';
import { chat } from './chat/agent.js';
import { getOrCreateConversation, appendMessage } from './chat/store.js';
import type { ProgressEvent } from './types/index.js';
import {
  getReputationSummary,
  getReputationClients,
  buildGiveFeedbackTx,
} from './erc8004/reputation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use('/erc8004', express.static(path.join(__dirname, '../erc8004')));

// x402 + admin bypass
const x402PayTo = process.env.X402_PAY_TO as `0x${string}` | undefined;
const x402Price = process.env.X402_PRICE || '$0.01';
const x402Network = (process.env.X402_NETWORK || 'base') as 'base' | 'base-sepolia';
const adminToken = process.env.ADMIN_TOKEN;

const x402Routes = {
  'POST /api/chat': {
    price: x402Price,
    network: x402Network,
    config: {
      description: 'MEV transaction analysis - one chat message',
      mimeType: 'text/event-stream',
    },
  },
};

function adminOrPaymentGate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = (req.headers['x-admin-token'] as string) || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (adminToken && token && token === adminToken) {
    return next();
  }
  if (x402PayTo?.startsWith('0x')) {
    return paymentMiddleware(x402PayTo, x402Routes)(req, res, next);
  }
  next();
}

if (x402PayTo?.startsWith('0x')) {
  console.log(`[x402] Payment gate enabled: ${x402Price} per request → ${x402PayTo.slice(0, 10)}...`);
}
if (adminToken) {
  console.log('[admin] Token bypass enabled for X-Admin-Token / Authorization: Bearer');
}

function jsonSafe(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
}

function sendSSE(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === 'object' ? jsonSafe(data) : String(data)}\n\n`);
}

app.post('/api/chat', adminOrPaymentGate, async (req, res) => {
  const { conversationId: bodyId, message } = req.body as { conversationId?: string; message?: string };
  const userMessage = typeof message === 'string' ? message.trim() : '';
  if (!userMessage) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const conv = getOrCreateConversation(bodyId);
  appendMessage(conv.id, 'user', userMessage);
  
  // Re-fetch conversation with updated messages
  const updatedConv = getOrCreateConversation(conv.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sendSSE(res, 'session', { conversationId: conv.id });

  try {
    const onProgress = (event: ProgressEvent) => {
      const data = 'payload' in event ? event.payload : ('content' in event ? { content: event.content } : {});
      sendSSE(res, event.type, data);
    };

    const onToken = (token: string) => {
      sendSSE(res, 'token', { content: token });
    };

    const result = await chat(updatedConv.messages, { onProgress, onToken });

    sendSSE(res, 'message_end', { content: result.response, toolsCalled: result.toolsCalled });
    appendMessage(conv.id, 'assistant', result.response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Chat error:', err);
    sendSSE(res, 'error', { message });
    sendSSE(res, 'message_end', { content: `Error: ${message}` });
    appendMessage(conv.id, 'assistant', `Error: ${message}`);
  }

  res.end();
});

// ERC-8004: Agent registration file (/.well-known/agent-registration.json)
app.get('/.well-known/agent-registration.json', (_req, res) => {
  const agentId = parseInt(process.env.ERC8004_AGENT_ID || '0', 10);
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  if (!agentId) {
    res.status(503).json({ error: 'ERC8004_AGENT_ID not configured' });
    return;
  }
  const registration = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Mevagent',
    description:
      'MEV/EVM transaction analysis agent. Explains swaps, arbitrage, token flows, and contract interactions in plain language.',
    image: `${baseUrl.replace(/\/$/, '')}/erc8004/mevagent-avatar.png`,
    services: [
      { name: 'web', endpoint: `${baseUrl.replace(/\/$/, '')}/api/chat` },
    ],
    x402Support: !!x402PayTo?.startsWith('0x'),
    active: true,
    registrations: [
      {
        agentId,
        agentRegistry: 'eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      },
    ],
    supportedTrust: ['reputation'],
  };
  res.setHeader('Content-Type', 'application/json');
  res.json(registration);
});

// ERC-8004: Reputation summary (clientAddresses from getClients when omitted)
app.get('/api/erc8004/reputation', async (_req, res) => {
  const agentId = parseInt(process.env.ERC8004_AGENT_ID || '0', 10);
  if (!agentId) {
    res.status(503).json({ error: 'ERC8004_AGENT_ID not configured' });
    return;
  }
  try {
    const clients = await getReputationClients(agentId);
    if (clients.length === 0) {
      res.json({ count: 0, summaryValue: 0, summaryValueDecimals: 0 });
      return;
    }
    const summary = await getReputationSummary(agentId, [...clients]);
    res.json({
      count: summary.count.toString(),
      summaryValue: summary.summaryValue.toString(),
      summaryValueDecimals: summary.summaryValueDecimals,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ERC-8004: Build giveFeedback tx params (frontend sends via wallet)
app.post('/api/erc8004/feedback-tx', (req, res) => {
  const agentId = parseInt(process.env.ERC8004_AGENT_ID || '0', 10);
  if (!agentId) {
    res.status(503).json({ error: 'ERC8004_AGENT_ID not configured' });
    return;
  }
  const { value, valueDecimals = 0, tag1 = 'starred', tag2 = '' } = req.body || {};
  if (typeof value !== 'number') {
    res.status(400).json({ error: 'value required (number, e.g. 1-100 for rating)' });
    return;
  }
  const tx = buildGiveFeedbackTx({
    agentId,
    value,
    valueDecimals: Math.min(18, Math.max(0, valueDecimals)),
    tag1: String(tag1 || ''),
    tag2: String(tag2 || ''),
  });
  res.json({
    to: tx.to,
    data: tx.data,
    value: tx.value.toString(),
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('POST /api/chat with { conversationId?, message } → SSE stream');
  console.log('Agent will automatically call tools when needed.');
});
