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
  queuedAt: number;
  deadlineAt: number;
  timer: NodeJS.Timeout;
  resolve(value: SearchResponse): void;
  reject(error: Error): void;
}

interface ActiveJob extends QueuedJob {
  worker: Worker;
  latest: SearchResponse | null;
  workerReused: boolean;
}

export class AiWorkerPool {
  readonly size = 1;
  private worker: Worker | null = null;
  private ready = false;
  private closed = false;
  private nextId = 1;
  private active: ActiveJob | null = null;
  private readonly queue: QueuedJob[] = [];
  private workerJobs = 0;

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
      const timeoutMs = Math.max(0, thinkMs);
      const job: QueuedJob = {
        id,
        payload,
        queuedAt: Date.now(),
        deadlineAt: Date.now() + timeoutMs,
        timer: undefined as unknown as NodeJS.Timeout,
        resolve,
        reject,
      };
      job.timer = setTimeout(() => {
        this.expire(job, thinkMs);
      }, timeoutMs);
      this.queue.push(job);
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
      clearTimeout(job.timer);
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
    this.workerJobs = 0;
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
        active.resolve({
          ...message.value,
          stats: {
            ...message.value.stats,
            queueMs: Math.max(
              0,
              Date.now() -
                active.queuedAt -
                (message.value.stats.searchMs ?? 0),
            ),
            workerReused: active.workerReused,
          },
        });
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
      this.failActive(
        new Error(`AI worker exited unexpectedly with code ${code}`),
      );
      this.worker = null;
      this.ready = false;
      this.spawnWorker();
      this.pump();
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
    if (job.deadlineAt <= Date.now()) {
      clearTimeout(job.timer);
      job.reject(new Error('AI worker deadline expired in queue'));
      this.pump();
      return;
    }
    const worker = this.worker;
    const active: ActiveJob = {
      ...job,
      worker,
      latest: null,
      workerReused: this.workerJobs > 0,
    };
    this.active = active;
    this.workerJobs += 1;
    worker.postMessage({
      id: job.id,
      payload: job.payload,
      deadlineAt: job.deadlineAt,
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

  private expire(job: QueuedJob, thinkMs: number): void {
    if (this.active?.id === job.id) {
      const active = this.active;
      this.active = null;
      if (active.latest) {
        active.resolve({
          ...active.latest,
          completed: false,
          stats: {
            ...active.latest.stats,
            queueMs: Math.max(
              0,
              Date.now() -
                active.queuedAt -
                (active.latest.stats.searchMs ?? 0),
            ),
            workerReused: active.workerReused,
          },
        });
      } else {
        active.reject(new Error(`AI worker exceeded ${thinkMs}ms`));
      }
      this.replaceWorker(active.worker);
      return;
    }
    const queuedIndex = this.queue.findIndex(
      (candidate) => candidate.id === job.id,
    );
    if (queuedIndex < 0) {
      return;
    }
    this.queue.splice(queuedIndex, 1);
    job.reject(new Error(`AI worker exceeded ${thinkMs}ms in queue`));
    this.pump();
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
