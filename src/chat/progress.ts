import { AsyncLocalStorage } from 'async_hooks';
import type { ProgressEvent } from '../types/index.js';

type ProgressSink = (event: ProgressEvent) => void;

const storage = new AsyncLocalStorage<{ onProgress: ProgressSink }>();

/**
 * Get the current progress sink (set by the HTTP layer for this request).
 * Nodes call this to emit progress events without changing the graph API.
 */
export function getProgress(): ProgressSink | undefined {
  return storage.getStore()?.onProgress;
}

/**
 * Run fn with the given progress sink. The server should call this before invoke.
 */
export function runWithProgress<T>(onProgress: ProgressSink, fn: () => Promise<T>): Promise<T> {
  return storage.run({ onProgress }, fn);
}
