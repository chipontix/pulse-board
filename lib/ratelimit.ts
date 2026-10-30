import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

// Sliding-window log in a sorted set: one member per accepted request, scored by
// Redis server time in ms. Atomic in one script, and using TIME means app
// instances with skewed clocks still share one window.
const SLIDING_WINDOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, now .. '-' .. ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, tonumber(oldest[2]) + window - now}`;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number; limit: number };

export async function rateLimit(redis: Redis, key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const [allowed, remaining, retryAfterMs] = (await redis.eval(SLIDING_WINDOW, 1, `pb:rl:${key}`, windowMs, limit, randomUUID())) as number[];
  return { allowed: allowed === 1, remaining, retryAfterMs, limit };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = { "X-RateLimit-Limit": String(r.limit), "X-RateLimit-Remaining": String(r.remaining) };
  if (!r.allowed) h["Retry-After"] = String(Math.max(1, Math.ceil(r.retryAfterMs / 1000)));
  return h;
}
