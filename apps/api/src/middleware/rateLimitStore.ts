import type { FastifyRateLimitStore } from "@fastify/rate-limit";

/** No LRU eviction: a busy server must not forget a still-active security limit. */
export class FixedWindowStore implements FastifyRateLimitStore {
  private readonly entries = new Map<string, { current: number; expires: number }>();
  private nextCleanup = 0;

  incr(key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void, timeWindow: number): void {
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [entryKey, entry] of this.entries) if (entry.expires <= now) this.entries.delete(entryKey);
      this.nextCleanup = now + timeWindow;
    }
    let entry = this.entries.get(key);
    if (!entry || entry.expires <= now) {
      entry = { current: 0, expires: now + timeWindow };
      this.entries.set(key, entry);
    }
    entry.current++;
    callback(null, { current: entry.current, ttl: Math.max(0, entry.expires - now) });
  }
  child(): FixedWindowStore { return new FixedWindowStore(); }
}
