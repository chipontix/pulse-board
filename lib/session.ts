import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

export const SESSION_COOKIE = "pb_session";
export const SESSION_TTL_S = 8 * 3600;

export type Session = { adminId: number; username: string; createdAt: number };

const key = (id: string) => `pb:sess:${id}`;

/** Server-side session: the cookie holds only a random id, the data lives in Redis with a sliding TTL. */
export async function createSession(redis: Redis, s: Omit<Session, "createdAt">): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await redis.set(key(id), JSON.stringify({ ...s, createdAt: Date.now() }), "EX", SESSION_TTL_S);
  return id;
}

export async function getSession(redis: Redis, id: string | undefined): Promise<Session | null> {
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const raw = await redis.getex(key(id), "EX", SESSION_TTL_S);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function destroySession(redis: Redis, id: string | undefined): Promise<void> {
  if (id) await redis.del(key(id));
}
