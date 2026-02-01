/**
 * In-memory store for A2A tasks (for GetTask polling).
 */
import type { Task } from './types.js';

const tasks = new Map<string, Task>();

export function saveTask(task: Task): void {
  tasks.set(task.id, task);
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function deleteTask(id: string): void {
  tasks.delete(id);
}
