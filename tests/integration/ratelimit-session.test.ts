import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit } from "../../lib/ratelimit.ts";
import { redis } from "../../lib/redis.ts";
import { SESSION_TTL_S, createSession, destroySession, getSession } from "../../lib/session.ts";
import { resetAll } from "./helpers.ts";

beforeEach(resetAll);

describe("sliding-window rate limit", () => {
  it("admits exactly the limit under concurrency", async () => {
    const rs = await Promise.all(Array.from({ length: 50 }, () => rateLimit(redis(), "k1", 10, 60_000)));
    expect(rs.filter((r) => r.allowed).length).toBe(10);
    expect(rs.filter((r) => r.allowed).map((r) => r.remaining).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const refused = rs.find((r) => !r.allowed)!;
    expect(refused.retryAfterMs).toBeGreaterThan(59_000);
    expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("slides: capacity comes back as old requests leave the window", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit(redis(), "k2", 3, 400)).allowed).toBe(true);
    expect((await rateLimit(redis(), "k2", 3, 400)).allowed).toBe(false);
    // generous margin: the colima VM clock gets stepped by up to ~150 ms by time sync
    await new Promise((r) => setTimeout(r, 800));
    expect((await rateLimit(redis(), "k2", 3, 400)).allowed).toBe(true);
  });

  it("does not count refused requests", async () => {
    for (let i = 0; i < 20; i++) await rateLimit(redis(), "k3", 2, 60_000);
    expect(await redis().zcard("pb:rl:k3")).toBe(2);
  });

  it("keeps keys apart and expires them", async () => {
    await rateLimit(redis(), "a", 1, 60_000);
    expect((await rateLimit(redis(), "b", 1, 60_000)).allowed).toBe(true);
    expect(await redis().pttl("pb:rl:a")).toBeGreaterThan(59_000);
  });
});

describe("sessions", () => {
  it("round-trips, slides the TTL and is gone after destroy", async () => {
    const id = await createSession(redis(), { adminId: 1, username: "admin" });
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await redis().expire(`pb:sess:${id}`, 10);
    expect(await getSession(redis(), id)).toMatchObject({ adminId: 1, username: "admin" });
    expect(await redis().ttl(`pb:sess:${id}`)).toBeGreaterThan(SESSION_TTL_S - 5);
    await destroySession(redis(), id);
    expect(await getSession(redis(), id)).toBeNull();
  });

  it("rejects malformed ids without touching Redis keys", async () => {
    expect(await getSession(redis(), undefined)).toBeNull();
    expect(await getSession(redis(), "*")).toBeNull();
  });
});
