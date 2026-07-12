export interface SyncQueueItem {
  sequence: number;
  kind: string;
  createdAt: number;
  coalesceKey?: string;
  execute: () => Promise<void>;
}

export interface SyncQueueHooks {
  onSuccess?: (latencyMs: number) => void;
  onFailure?: (error: Error) => void;
  onCoalesced?: () => void;
}

export class SyncDispatchQueue {
  private readonly pending: SyncQueueItem[] = [];
  private running = false;
  private stopped = false;

  constructor(
    private readonly maxDepth = 512,
    private readonly hooks: SyncQueueHooks = {},
  ) {}

  get depth(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  enqueue(item: SyncQueueItem): void {
    if (this.stopped) throw new Error('Sync queue is stopped');
    if (item.coalesceKey) {
      const lastIndex = this.pending.length - 1;
      if (lastIndex >= 0 && this.pending[lastIndex].coalesceKey === item.coalesceKey) {
        this.pending.splice(lastIndex, 1, item);
        this.hooks.onCoalesced?.();
        return;
      }
    }
    if (this.pending.length >= this.maxDepth) {
      throw new Error(`Sync queue exceeded its ${this.maxDepth} event limit`);
    }
    this.pending.push(item);
    void this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.pending.splice(0);
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.pending.length > 0) {
        const item = this.pending.shift()!;
        try {
          await item.execute();
          this.hooks.onSuccess?.(Date.now() - item.createdAt);
        } catch (error) {
          this.hooks.onFailure?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
