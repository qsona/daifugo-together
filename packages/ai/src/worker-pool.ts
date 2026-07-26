import { Worker } from 'node:worker_threads';

import type {
  SearchRequest,
  SearchResponse,
  WorkerRequest,
  WorkerResponse,
} from './worker-protocol.js';

interface PendingJob {
  resolve(value: SearchResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class AiWorkerPool {
  readonly size = 1;
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(new URL('./worker-entry.js', import.meta.url), {
      name: 'daifugo-ai-1',
    });
    worker.on('message', (message: WorkerResponse) => {
      const job = this.pending.get(message.id);
      if (!job) {
        return;
      }
      clearTimeout(job.timer);
      this.pending.delete(message.id);
      if (message.ok) {
        job.resolve(message.value);
      } else {
        job.reject(new Error(message.error));
      }
    });
    worker.on('error', (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.worker = null;
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.rejectAll(new Error(`AI worker exited with code ${code}`));
      }
      if (this.worker === worker) {
        this.worker = null;
      }
    });
    this.worker = worker;
    return worker;
  }

  run(payload: SearchRequest, timeoutMs: number): Promise<SearchResponse> {
    const id = this.nextId;
    this.nextId += 1;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AI worker exceeded ${timeoutMs}ms`));
        void worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, payload } satisfies WorkerRequest);
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      await worker.terminate();
    }
    this.rejectAll(new Error('AI worker pool closed'));
  }

  private rejectAll(error: Error): void {
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
  }
}
