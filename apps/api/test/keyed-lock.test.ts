import { describe, expect, it } from 'vitest';
import { KeyedLock } from '../src/modules/keyed-lock.js';

/** Unit coverage for the mutex that makes the E1-07 caps hold under concurrency. */
describe('KeyedLock', () => {
  it('never runs two tasks for the same key at once', async () => {
    const lock = new KeyedLock();
    let inside = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        lock.run('same', async () => {
          inside += 1;
          peak = Math.max(peak, inside);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inside -= 1;
        }),
      ),
    );

    expect(peak).toBe(1);
    expect(lock.size).toBe(0);
  });

  it('runs different keys in parallel', async () => {
    const lock = new KeyedLock();
    let inside = 0;
    let peak = 0;

    await Promise.all(
      ['a', 'b', 'c', 'd'].map((key) =>
        lock.run(key, async () => {
          inside += 1;
          peak = Math.max(peak, inside);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inside -= 1;
        }),
      ),
    );

    expect(peak).toBe(4);
  });

  it('keeps the queue alive after a failure and returns each result to its caller', async () => {
    const lock = new KeyedLock();
    const order: string[] = [];

    const failing = lock.run('k', async () => {
      order.push('first');
      throw new Error('boom');
    });
    const following = lock.run('k', async () => {
      order.push('second');
      return 'ok';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('ok');
    expect(order).toEqual(['first', 'second']);
  });
});
