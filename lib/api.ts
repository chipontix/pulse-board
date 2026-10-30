import { clientIp } from "./auth.ts";
import { redis } from "./redis.ts";
import { rateLimit, rateLimitHeaders } from "./ratelimit.ts";

const LIMIT = Number(process.env.API_RATE_LIMIT ?? 60);
const WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS ?? 60_000);

/** Public API wrapper: per-IP sliding-window limit; headers on every response. */
export async function limited(req: Request, bucket: string, handler: () => Promise<Response>): Promise<Response> {
  const r = await rateLimit(redis(), `${bucket}:${clientIp(req.headers)}`, LIMIT, WINDOW_MS);
  const res = r.allowed ? await handler() : Response.json({ error: "rate limit exceeded" }, { status: 429 });
  for (const [k, v] of Object.entries(rateLimitHeaders(r))) res.headers.set(k, v);
  return res;
}
