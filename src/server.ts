/**
 * Chat API server with SSE for conversational tx analysis (方案 A).
 * POST /api/chat → SSE stream: progress events + message_end with report or reply.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { analyzeTx } from './graph/workflow.js';
import { detectIntent } from './chat/intent.js';
import { getOrCreateConversation, appendMessage } from './chat/store.js';
import type { ProgressEvent } from './types/index.js';

const app = express();
app.use(cors());
app.use(express.json());

function jsonSafe(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
}

function sendSSE(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === 'object' ? jsonSafe(data) : String(data)}\n\n`);
}

app.post('/api/chat', async (req, res) => {
  const { conversationId: bodyId, message } = req.body as { conversationId?: string; message?: string };
  const userMessage = typeof message === 'string' ? message.trim() : '';
  if (!userMessage) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const conv = getOrCreateConversation(bodyId);
  appendMessage(conv.id, 'user', userMessage);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sendSSE(res, 'session', { conversationId: conv.id });

  const intent = detectIntent(userMessage);

  if (intent.type === 'analyze_tx' && intent.payload?.txHash) {
    const txHash = intent.payload.txHash;
    if (!txHash.startsWith('0x') || txHash.length !== 66) {
      sendSSE(res, 'error', { message: 'Invalid transaction hash format.' });
      sendSSE(res, 'message_end', { content: 'Please provide a valid transaction hash (0x + 64 hex characters).' });
      appendMessage(conv.id, 'assistant', 'Please provide a valid transaction hash (0x + 64 hex characters).');
      res.end();
      return;
    }

    try {
      const onProgress = (event: ProgressEvent) => sendSSE(res, event.type, event);
      const result = await analyzeTx(txHash, 'ethereum', { onProgress });

      if (result.error) {
        sendSSE(res, 'error', { message: result.error });
      }

      const report = result.finalReport;
      const content = report?.summary ?? (result.error ? `Error: ${result.error}` : 'No report generated.');
      sendSSE(res, 'message_end', { content, report: report ?? null });
      appendMessage(conv.id, 'assistant', content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendSSE(res, 'error', { message, step: 'analyze' });
      sendSSE(res, 'message_end', { content: `Error: ${message}` });
      appendMessage(conv.id, 'assistant', `Error: ${message}`);
    }
  } else {
    const content = 'Send a transaction hash (0x...) to analyze it.';
    sendSSE(res, 'message_end', { content });
    appendMessage(conv.id, 'assistant', content);
  }

  res.end();
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('POST /api/chat with { conversationId?, message } → SSE stream');
});
