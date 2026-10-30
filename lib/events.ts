import type { Redis } from "ioredis";
import type { ServiceStatus } from "./status.ts";
import { newRedis } from "./redis.ts";

export const CHANNEL = "pb:events";

export type PulseEvent =
  | { type: "service"; slug: string; status: ServiceStatus; sentAt: number }
  | { type: "incident"; incidentId: number; sentAt: number }
  | { type: "bench"; seq: number; sentAt: number };

type Unsent<E> = E extends unknown ? Omit<E, "sentAt"> : never;

export async function publish(redis: Redis, e: Unsent<PulseEvent>): Promise<void> {
  await redis.publish(CHANNEL, JSON.stringify({ ...e, sentAt: Date.now() }));
}

// One Redis subscriber per app process, fanned out in memory to every SSE client,
// so N browsers cost one Redis connection, not N.
type Listener = (raw: string) => void;
const g = globalThis as { pbHub?: { sub: Redis; listeners: Set<Listener> } };

export function subscribe(fn: Listener): () => void {
  if (!g.pbHub) {
    const sub = newRedis();
    const listeners = new Set<Listener>();
    sub.subscribe(CHANNEL).catch((e) => console.error("subscribe failed", e));
    sub.on("message", (_ch: string, raw: string) => {
      for (const l of listeners) l(raw);
    });
    g.pbHub = { sub, listeners };
  }
  const { listeners } = g.pbHub;
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listenerCount(): number {
  return g.pbHub?.listeners.size ?? 0;
}
