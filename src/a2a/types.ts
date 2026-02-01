/**
 * Minimal A2A protocol types (HTTP+JSON binding).
 * See https://a2a-protocol.org/latest/specification/
 */

export const TASK_STATE = {
  SUBMITTED: 'TASK_STATE_SUBMITTED',
  WORKING: 'TASK_STATE_WORKING',
  COMPLETED: 'TASK_STATE_COMPLETED',
  FAILED: 'TASK_STATE_FAILED',
  CANCELED: 'TASK_STATE_CANCELED',
  INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
  REJECTED: 'TASK_STATE_REJECTED',
} as const;

export const ROLE = {
  USER: 'ROLE_USER',
  AGENT: 'ROLE_AGENT',
} as const;

export interface Part {
  text?: string;
  url?: string;
  data?: unknown;
  mediaType?: string;
}

export interface Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: string;
  message?: Message;
  timestamp?: string;
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export interface SendMessageRequest {
  message: Message;
  configuration?: {
    blocking?: boolean;
    historyLength?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface StreamResponse {
  task?: Task;
  message?: Message;
  statusUpdate?: TaskStatusUpdateEvent;
  artifactUpdate?: TaskArtifactUpdateEvent;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
}
