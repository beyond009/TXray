/**
 * Chat API server with SSE for conversational tx analysis.
 * Uses LangGraph agent with tool calling - LLM decides when to analyze.
 * POST /api/chat → SSE stream: progress events + message_end with response.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chat } from './chat/agent.js';
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

  try {
    const onProgress = (event: ProgressEvent) => {
      const data = 'payload' in event ? event.payload : ('content' in event ? { content: event.content } : {});
      sendSSE(res, event.type, data);
    };

    const onToken = (token: string) => {
      sendSSE(res, 'token', { content: token });
    };

    const result = await chat(conv.messages, { onProgress, onToken });

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

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('POST /api/chat with { conversationId?, message } → SSE stream');
  console.log('Agent will automatically call tools when needed.');
});
