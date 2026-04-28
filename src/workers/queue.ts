// src/workers/queue.ts
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 2 });

export function enqueueGenerateExport(fn: () => Promise<void>): void {
  queue.add(fn).catch((err) => console.error('[queue] generate-export failed', err));
}
