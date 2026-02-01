/**
 * A2A protocol handlers (message:send, message:stream, getTask).
 */
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { chat } from '../chat/agent.js';
import { getOrCreateConversation, appendMessage } from '../chat/store.js';
import type {
  SendMessageRequest,
  Task,
  Artifact,
  TaskStatusUpdateEvent,
  StreamResponse,
} from './types.js';
import { TASK_STATE } from './types.js';
import { saveTask, getTask } from './taskStore.js';

function jsonSafe(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
}

function extractTextFromMessage(msg: { parts?: Array<{ text?: string }> }): string {
  if (!msg.parts || !Array.isArray(msg.parts)) return '';
  for (const p of msg.parts) {
    if (typeof p.text === 'string' && p.text.trim()) return p.text.trim();
  }
  return '';
}

function a2aError(res: Response, status: number, type: string, detail: string): void {
  res.status(status).json({
    type: `https://a2a-protocol.org/errors/${type}`,
    title: detail,
    status,
    detail,
  });
}

export async function handleSendMessage(req: Request, res: Response): Promise<void> {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json') && !contentType.includes('application/a2a+json')) {
    a2aError(res, 415, 'content-type-not-supported', 'Content-Type must be application/json or application/a2a+json');
    return;
  }

  const body = req.body as SendMessageRequest;
  const message = body?.message;
  if (!message || !message.parts?.length) {
    a2aError(res, 400, 'invalid-params', 'message with parts is required');
    return;
  }

  const userText = extractTextFromMessage(message);
  if (!userText) {
    a2aError(res, 400, 'invalid-params', 'message must contain at least one text part');
    return;
  }

  const blocking = body.configuration?.blocking ?? true;
  const contextId = message.contextId;
  const conv = getOrCreateConversation(contextId);
  appendMessage(conv.id, 'user', userText);
  const updatedConv = getOrCreateConversation(conv.id);

  const taskId = randomUUID();
  const artifactId = randomUUID();
  const now = new Date().toISOString();

  const runChat = async () => {
    try {
      const result = await chat(
        updatedConv.messages.map((m) => ({ role: m.role, content: m.content })),
        {}
      );
      appendMessage(conv.id, 'assistant', result.response);

      const artifact: Artifact = {
        artifactId,
        name: 'Analysis',
        parts: [{ text: result.response, mediaType: 'text/plain' }],
      };

      const task: Task = {
        id: taskId,
        contextId: conv.id,
        status: {
          state: TASK_STATE.COMPLETED,
          timestamp: new Date().toISOString(),
        },
        artifacts: [artifact],
      };
      saveTask(task);
      return { task, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const task: Task = {
        id: taskId,
        contextId: conv.id,
        status: {
          state: TASK_STATE.FAILED,
          message: {
            messageId: randomUUID(),
            role: 'ROLE_AGENT',
            parts: [{ text: `Error: ${msg}` }],
          },
          timestamp: new Date().toISOString(),
        },
      };
      saveTask(task);
      return { task, error: msg };
    }
  };

  if (blocking) {
    const { task } = await runChat();
    res.setHeader('Content-Type', 'application/a2a+json');
    res.status(200).json({ task });
    return;
  }

  const initialTask: Task = {
    id: taskId,
    contextId: conv.id,
    status: { state: TASK_STATE.SUBMITTED, timestamp: now },
  };
  saveTask(initialTask);
  res.setHeader('Content-Type', 'application/a2a+json');
  res.status(200).json({ task: initialTask });

  runChat().catch((err) => console.error('[A2A] Background chat error:', err));
}

export async function handleStreamMessage(req: Request, res: Response): Promise<void> {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json') && !contentType.includes('application/a2a+json')) {
    a2aError(res, 415, 'content-type-not-supported', 'Content-Type must be application/json or application/a2a+json');
    return;
  }

  const body = req.body as SendMessageRequest;
  const message = body?.message;
  if (!message || !message.parts?.length) {
    a2aError(res, 400, 'invalid-params', 'message with parts is required');
    return;
  }

  const userText = extractTextFromMessage(message);
  if (!userText) {
    a2aError(res, 400, 'invalid-params', 'message must contain at least one text part');
    return;
  }

  const contextId = message.contextId;
  const conv = getOrCreateConversation(contextId);
  appendMessage(conv.id, 'user', userText);
  const updatedConv = getOrCreateConversation(conv.id);

  const taskId = randomUUID();
  const contextIdRes = conv.id;
  const artifactId = randomUUID();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendStreamEvent = (data: StreamResponse) => {
    res.write(`data: ${jsonSafe(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  const initialTask: Task = {
    id: taskId,
    contextId: contextIdRes,
    status: { state: TASK_STATE.WORKING, timestamp: new Date().toISOString() },
  };
  sendStreamEvent({ task: initialTask });

  try {
    const result = await chat(
      updatedConv.messages.map((m) => ({ role: m.role, content: m.content })),
      {}
    );

    const fullResponse = result.response;
    appendMessage(conv.id, 'assistant', fullResponse);

    sendStreamEvent({
      artifactUpdate: {
        taskId,
        contextId: contextIdRes,
        artifact: {
          artifactId,
          name: 'Analysis',
          parts: [{ text: fullResponse, mediaType: 'text/plain' }],
        },
        append: false,
        lastChunk: true,
      },
    });

    const statusUpdate: TaskStatusUpdateEvent = {
      taskId,
      contextId: contextIdRes,
      status: { state: TASK_STATE.COMPLETED, timestamp: new Date().toISOString() },
    };
    sendStreamEvent({ statusUpdate });

    const finalTask: Task = {
      id: taskId,
      contextId: contextIdRes,
      status: statusUpdate.status,
      artifacts: [{ artifactId, name: 'Analysis', parts: [{ text: fullResponse }] }],
    };
    saveTask(finalTask);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusUpdate: TaskStatusUpdateEvent = {
      taskId,
      contextId: contextIdRes,
      status: {
        state: TASK_STATE.FAILED,
        message: {
          messageId: randomUUID(),
          role: 'ROLE_AGENT',
          parts: [{ text: `Error: ${msg}` }],
        },
        timestamp: new Date().toISOString(),
      },
    };
    sendStreamEvent({ statusUpdate });
    const failedTask: Task = {
      id: taskId,
      contextId: contextIdRes,
      status: statusUpdate.status,
    };
    saveTask(failedTask);
  }

  res.end();
}

export async function handleGetTask(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!id) {
    a2aError(res, 400, 'invalid-params', 'task id is required');
    return;
  }

  const task = getTask(id);
  if (!task) {
    res.status(404).json({
      type: 'https://a2a-protocol.org/errors/task-not-found',
      title: 'Task Not Found',
      status: 404,
      detail: `Task ${id} does not exist or is not accessible`,
    });
    return;
  }

  res.setHeader('Content-Type', 'application/a2a+json');
  res.status(200).json(task);
}
