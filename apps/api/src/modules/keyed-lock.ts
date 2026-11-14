/**
 * Per-key async mutex (task E1-07).
 *
 * Every cap in the product is a read-then-write check: "count my open orders", "is a code already
 * pending", "was this refresh token rotated?". Two requests that arrive together both read the same
 * state and both pass the check, so a flood can walk straight through a limit that looks correct in
 * a sequential test. Running the critical section through this lock serialises the check with the
 * write, so the cap holds under concurrency inside one process.
 *
 * Scope: one process. A multi-instance deployment needs the matching database constraint as well
 * (see docs/ASSUMPTIONS.md A34) — the lock is the cheap half, the constraint is the durable half.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();
  private waiting = 0;

  /** Number of tasks currently queued or running (test/diagnostic helper). */
  get size(): number {
    return this.waiting;
  }

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The tail a later caller waits on; it never rejects, so one failure cannot poison the queue.
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    this.waiting += 1;
    await previous;
    try {
      return await task();
    } finally {
      this.waiting -= 1;
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
