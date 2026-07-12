import {describe, expect, test, vi} from 'vitest';
import {SyncDispatchQueue} from '../src/sync/dispatch-queue';

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for queue');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

describe('sync dispatch queue', () => {
  test('preserves critical event order', async () => {
    const output: number[] = [];
    const queue = new SyncDispatchQueue();
    for (let sequence = 1; sequence <= 20; sequence += 1) {
      queue.enqueue({
        sequence,
        kind: 'key',
        createdAt: Date.now(),
        execute: async () => {
          output.push(sequence);
        },
      });
    }
    await waitFor(() => output.length === 20);
    expect(output).toEqual(Array.from({length: 20}, (_, index) => index + 1));
  });

  test('coalesces pending mouse movement without dropping clicks', async () => {
    const release: Array<() => void> = [];
    const output: string[] = [];
    const onCoalesced = vi.fn();
    const queue = new SyncDispatchQueue(10, {onCoalesced});
    queue.enqueue({
      sequence: 1,
      kind: 'block',
      createdAt: Date.now(),
      execute: () => new Promise<void>(resolve => release.push(resolve)),
    });
    queue.enqueue({
      sequence: 2,
      kind: 'move-1',
      coalesceKey: 'move',
      createdAt: Date.now(),
      execute: async () => output.push('move-1'),
    });
    queue.enqueue({
      sequence: 3,
      kind: 'move-2',
      coalesceKey: 'move',
      createdAt: Date.now(),
      execute: async () => output.push('move-2'),
    });
    queue.enqueue({
      sequence: 4,
      kind: 'click',
      createdAt: Date.now(),
      execute: async () => output.push('click'),
    });
    release[0]();
    await waitFor(() => output.length === 2);
    expect(output).toEqual(['move-2', 'click']);
    expect(onCoalesced).toHaveBeenCalledTimes(1);
  });

  test('does not move a later pointer event ahead of a critical event', async () => {
    const release: Array<() => void> = [];
    const output: string[] = [];
    const queue = new SyncDispatchQueue(10);
    queue.enqueue({
      sequence: 1,
      kind: 'block',
      createdAt: Date.now(),
      execute: () => new Promise<void>(resolve => release.push(resolve)),
    });
    queue.enqueue({
      sequence: 2,
      kind: 'move-1',
      coalesceKey: 'move',
      createdAt: Date.now(),
      execute: async () => output.push('move-1'),
    });
    queue.enqueue({
      sequence: 3,
      kind: 'click',
      createdAt: Date.now(),
      execute: async () => output.push('click'),
    });
    queue.enqueue({
      sequence: 4,
      kind: 'move-2',
      coalesceKey: 'move',
      createdAt: Date.now(),
      execute: async () => output.push('move-2'),
    });
    release[0]();
    await waitFor(() => output.length === 3);
    expect(output).toEqual(['move-1', 'click', 'move-2']);
  });

  test('rejects unbounded critical queues', async () => {
    const queue = new SyncDispatchQueue(1);
    let release = () => undefined;
    queue.enqueue({
      sequence: 1,
      kind: 'block',
      createdAt: Date.now(),
      execute: () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    });
    queue.enqueue({
      sequence: 2,
      kind: 'key',
      createdAt: Date.now(),
      execute: async () => undefined,
    });
    expect(() =>
      queue.enqueue({
        sequence: 3,
        kind: 'key',
        createdAt: Date.now(),
        execute: async () => undefined,
      }),
    ).toThrow('event limit');
    release();
  });
});
