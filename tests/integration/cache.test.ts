import { beforeEach, describe, expect, it } from "vitest";
import { SwrCache } from "../../lib/cache.ts";
import { redis } from "../../lib/redis.ts";
import { resetAll, until } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(resetAll);

describe("SwrCache", () => {
  it("misses once, then serves fresh hits; concurrent misses share one load", async () => {
    let loads = 0;
    const c = new SwrCache(redis(), "t:a", async () => { loads++; await sleep(50); return { n: loads }; }, { freshMs: 10_000, staleMs: 10_000 });
    const first = await Promise.all(Array.from({ length: 10 }, () => c.get()));
    expect(loads).toBe(1);
    expect(first.every((r) => r.state === "miss" && r.value.n === 1)).toBe(true);
    expect((await c.get()).state).toBe("fresh");
    await until(async () => (await c.stats()).fresh === 1);
    expect(await c.stats()).toEqual({ fresh: 1, stale: 0, miss: 10 });
  });

  it("serves stale while one background refresh runs", async () => {
    let loads = 0;
    const c = new SwrCache(redis(), "t:b", async () => { loads++; await sleep(100); return loads; }, { freshMs: 50, staleMs: 10_000 });
    await c.get();
    await sleep(60);
    const stale = await Promise.all(Array.from({ length: 5 }, () => c.get()));
    expect(stale.map((r) => [r.state, r.value])).toEqual(Array(5).fill(["stale", 1]));
    await until(async () => (await c.get()).state === "fresh");
    expect((await c.get()).value).toBe(2);
    expect(loads).toBe(2); // the lock let only one of the five refresh
  });

  it("drops the value after fresh + stale", async () => {
    const c = new SwrCache(redis(), "t:c", async () => 1, { freshMs: 20, staleMs: 30 });
    await c.get();
    await sleep(80);
    expect((await c.get()).state).toBe("miss");
  });

  it("invalidate() removes the value, and a load that straddles it is not stored", async () => {
    let version = 1;
    let gate: () => void = () => {};
    let loads = 0;
    const c = new SwrCache(redis(), "t:d", async () => {
      loads++;
      const v = version;
      if (loads === 1) await new Promise<void>((r) => { gate = r; });
      return v;
    }, { freshMs: 10_000, staleMs: 10_000 });

    const slow = c.get(); // reads version 1, then blocks
    await until(() => loads === 1);
    version = 2;
    await c.invalidate(); // the event: Postgres already has version 2
    gate();
    // The straddling load is retried, so even its own caller sees version 2.
    expect((await slow).value).toBe(2);
    expect((await c.get())).toEqual({ value: 2, state: "fresh" });
    expect(loads).toBe(2);
  });
});
