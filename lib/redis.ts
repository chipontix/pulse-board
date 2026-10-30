import { Redis } from "ioredis";

const g = globalThis as { pbRedis?: Redis };

export function newRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 2 });
}

/** Shared connection for commands. Subscribers need their own (see events.ts). */
export function redis(): Redis {
  g.pbRedis ??= newRedis();
  return g.pbRedis;
}
