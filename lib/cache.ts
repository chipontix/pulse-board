import type { Redis } from "ioredis";

export type Freshness = "fresh" | "stale" | "miss";

type Entry<T> = { v: T; freshUntil: number };

/** Pure part of stale-while-revalidate: what to do with an entry read at `now`. */
export function freshness(entry: { freshUntil: number } | null, now: number): Freshness {
  if (!entry) return "miss";
  return now < entry.freshUntil ? "fresh" : "stale";
}

// Writes the value only if no invalidation happened since the loader started.
// Without this a loader that read Postgres just before an event would put the
// old snapshot back right after the event deleted it.
const SET_IF_GEN = `
if (redis.call('GET', KEYS[1]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

export type SwrOptions = { freshMs: number; staleMs: number };

/**
 * Redis-backed stale-while-revalidate cache for one key.
 * fresh: served from Redis. stale: served from Redis, one refresh in the background
 * (a short Redis lock keeps it to one refresher across all app instances).
 * miss: loaded inline; concurrent misses in one process share a single load.
 * invalidate(): bumps a generation counter and deletes the value.
 */
export class SwrCache<T> {
  private inflight: Promise<T> | null = null;
  readonly redis: Redis;
  readonly key: string;
  readonly load: () => Promise<T>;
  readonly opts: SwrOptions;

  constructor(redis: Redis, key: string, load: () => Promise<T>, opts: SwrOptions) {
    this.redis = redis;
    this.key = key;
    this.load = load;
    this.opts = opts;
  }

  private get genKey() { return `${this.key}:gen`; }
  private get lockKey() { return `${this.key}:lock`; }
  private get statsKey() { return `${this.key}:stats`; }

  async get(): Promise<{ value: T; state: Freshness }> {
    const raw = await this.redis.get(this.key);
    const entry = raw ? (JSON.parse(raw) as Entry<T>) : null;
    const state = freshness(entry, Date.now());
    void this.redis.hincrby(this.statsKey, state, 1).catch(() => {});
    if (entry && state === "fresh") return { value: entry.v, state };
    if (entry) {
      const got = await this.redis.set(this.lockKey, "1", "PX", 5000, "NX");
      if (got) void this.refresh().catch(() => {}).finally(() => this.redis.del(this.lockKey));
      return { value: entry.v, state };
    }
    return { value: await this.refresh(), state };
  }

  /** Loads and stores; concurrent calls in this process share one load. */
  refresh(): Promise<T> {
    this.inflight ??= (async () => {
      try {
        // An invalidation during the load means callers waiting on this promise
        // may have been told about the change already: load again (bounded).
        for (let attempt = 0; ; attempt++) {
          const gen = (await this.redis.get(this.genKey)) ?? "0";
          const v = await this.load();
          const entry: Entry<T> = { v, freshUntil: Date.now() + this.opts.freshMs };
          const stored = await this.redis.eval(SET_IF_GEN, 2, this.genKey, this.key, gen, JSON.stringify(entry), this.opts.freshMs + this.opts.staleMs);
          if (stored === 1 || attempt === 2) return v;
        }
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async invalidate(): Promise<void> {
    await this.redis.multi().incr(this.genKey).del(this.key).exec();
  }

  async stats(): Promise<Record<Freshness, number>> {
    const h = await this.redis.hgetall(this.statsKey);
    return { fresh: Number(h.fresh ?? 0), stale: Number(h.stale ?? 0), miss: Number(h.miss ?? 0) };
  }

  async resetStats(): Promise<void> {
    await this.redis.del(this.statsKey);
  }
}
