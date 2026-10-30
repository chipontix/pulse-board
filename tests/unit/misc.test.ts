import { describe, expect, it } from "vitest";
import { freshness } from "../../lib/cache.ts";
import { hashPassword, verifyPassword } from "../../lib/password.ts";
import { rateLimitHeaders } from "../../lib/ratelimit.ts";
import { clientIp } from "../../lib/auth.ts";

describe("freshness", () => {
  it("is a miss without an entry", () => expect(freshness(null, 1000)).toBe("miss"));
  it("is fresh before freshUntil and stale from it on", () => {
    expect(freshness({ freshUntil: 1000 }, 999)).toBe("fresh");
    expect(freshness({ freshUntil: 1000 }, 1000)).toBe("stale");
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct hors", h)).toBe(false);
  });
  it("salts every hash", async () => expect(await hashPassword("x")).not.toBe(await hashPassword("x")));
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });
});

describe("rateLimitHeaders", () => {
  it("sets Retry-After in whole seconds, at least 1, only when refused", () => {
    expect(rateLimitHeaders({ allowed: true, remaining: 3, retryAfterMs: 0, limit: 5 })).toEqual({ "X-RateLimit-Limit": "5", "X-RateLimit-Remaining": "3" });
    expect(rateLimitHeaders({ allowed: false, remaining: 0, retryAfterMs: 1200, limit: 5 })["Retry-After"]).toBe("2");
    expect(rateLimitHeaders({ allowed: false, remaining: 0, retryAfterMs: 3, limit: 5 })["Retry-After"]).toBe("1");
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => expect(clientIp(new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" }))).toBe("10.0.0.1"));
  it("falls back when missing", () => expect(clientIp(new Headers())).toBe("unknown"));
});
