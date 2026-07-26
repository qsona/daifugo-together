import { Worker } from 'node:worker_threads';

import type {
  SearchRequest,
  SearchResponse,
  WorkerRequest,
  WorkerResponse,
} from './worker-protocol.js';

interface QueuedJob {
  id: number;
  payload: SearchRequest;
  thinkMs: number;
  resolve(value: SearchResponse): void;
  reject(error: Error): void;
}

interface ActiveJob extends QueuedJob {
  timer: NodeJS.Timeout;
  latest: SearchResponse | null;
}

export class AiWorkerPool {
  readonly size = 1;
  private worker: Worker | null = null;
  private ready = false;
  private closed = false;
  private nextId = 1;
  private active: ActiveJob | null = null;
  private readonly queue: QueuedJob[] = [];

  constructor(
    private readonly workerUrl = new URL('./worker-entry.js', import.meta.url),
  ) {
    this.spawnWorker();
  }

  run(payload: SearchRequest, thinkMs: number): Promise<SearchResponse> {
    if (this.closed) {
      return Promise.reject(new Error('AI worker pool is closed'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.queue.push({ id, payload, thinkMs, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const error = new Error('AI worker pool closed');
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(error);
      this.active = null;
    }
    for (const job of this.queue.splice(0)) {
      job.reject(error);
    }
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    if (worker) {
      await worker.terminate();
    }
  }

  private spawnWorker(): void {
    if (this.closed || this.worker) {
      return;
    }
    const worker = new Worker(this.workerUrl, {
      name: 'daifugo-ai-1',
    });
    this.worker = worker;
    this.ready = false;
    worker.on('message', (message: WorkerResponse) => {
      if (this.worker !== worker) {
        return;
      }
      if (message.kind === 'ready') {
        this.ready = true;
        this.pump();
        return;
      }
      const active = this.active;
      if (!active || active.id !== message.id) {
        return;
      }
      if (message.kind === 'progress') {
        active.latest = message.value;
        return;
      }
      clearTimeout(active.timer);
      this.active = null;
      if (message.kind === 'result') {
        active.resolve(message.value);
      } else {
        active.reject(new Error(message.error));
      }
      this.pump();
    });
    worker.on('error', (error) => {
      if (this.worker !== worker) {
        return;
      }
      this.failActive(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.replaceWorker(worker);
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) {
        return;
      }
      if (code !== 0) {
        this.failActive(new Error(`AI worker exited with code ${code}`));
      }
      this.worker = null;
      this.ready = false;
      this.spawnWorker();
    });
  }

  private pump(): void {
    if (this.closed || this.active || !this.worker || !this.ready) {
      return;
    }
    const job = this.queue.shift();
    if (!job) {
      return;
    }
    const worker = this.worker;
    const active: ActiveJob = {
      ...job,
      latest: null,
      timer: setTimeout(() => {
        if (this.active !== active) {
          return;
        }
        this.active = null;
        if (active.latest) {
          active.resolve({ ...active.latest, completed: false });
        } else {
          active.reject(new Error(`AI worker exceeded ${active.thinkMs}ms`));
        }
        this.replaceWorker(worker);
      }, job.thinkMs),
    };
    this.active = active;
    worker.postMessage({
      id: job.id,
      payload: job.payload,
    } satisfies WorkerRequest);
  }

  private failActive(error: Error): void {
    if (!this.active) {
      return;
    }
    clearTimeout(this.active.timer);
    this.active.reject(error);
    this.active = null;
  }

  private replaceWorker(worker: Worker): void {
    if (this.worker !== worker) {
      return;
    }
    this.worker = null;
    this.ready = false;
    void worker.terminate().finally(() => {
      this.spawnWorker();
      this.pump();
    });
  }
}
