import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db.ts";
import { setServiceOverride } from "../../lib/ops.ts";
import { claimDue, pruneChecks, tick } from "../../worker/run.ts";
import { addService, collectEvents, resetAll, until } from "./helpers.ts";

let server: Server;
let base = "";
let mode: "ok" | "fail" | "slow" = "ok";

beforeAll(async () => {
  server = createServer((_req, res) => {
    if (mode === "fail") res.writeHead(500).end();
    else if (mode === "slow") setTimeout(() => res.writeHead(200).end(), 300);
    else res.writeHead(200).end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => { await resetAll(); mode = "ok"; });

const due = () => db().query("UPDATE services SET next_check_at = now()");
const status = async (slug: string) => (await db().query("SELECT status FROM services WHERE slug = $1", [slug])).rows[0].status;

describe("worker", () => {
  it("records checks and walks a service through degraded and down, publishing only changes", async () => {
    await addService("api", base);
    const ev = await collectEvents();
    const seen = async () => ev.events.map((e) => e.type === "service" && e.status);

    await tick(db());
    expect(await status("api")).toBe("operational");

    mode = "fail";
    for (const expected of ["degraded", "degraded", "down", "down"]) {
      await due();
      await tick(db());
      expect(await status("api")).toBe(expected);
    }
    mode = "ok";
    await due();
    await tick(db());
    expect(await status("api")).toBe("operational");

    await until(async () => (await seen()).length === 4);
    expect(await seen()).toEqual(["operational", "degraded", "down", "operational"]);
    const checks = await db().query("SELECT ok, http_status, error FROM checks ORDER BY id");
    expect(checks.rows.map((r) => r.ok)).toEqual([true, false, false, false, false, true]);
    expect(checks.rows[1]).toMatchObject({ http_status: 500, error: "unexpected status 500" });
    await ev.stop();
  });

  it("marks slow answers degraded and timeouts as failures", async () => {
    await addService("slow", base, { degraded_latency_ms: 100, timeout_ms: 1000 });
    await addService("timeout", base, { timeout_ms: 100 });
    mode = "slow";
    await tick(db());
    expect(await status("slow")).toBe("degraded");
    expect(await status("timeout")).toBe("degraded");
    const r = await db().query("SELECT error FROM checks c JOIN services s ON s.id = c.service_id WHERE s.slug = 'timeout'");
    expect(r.rows[0].error).toBe("timeout after 100 ms");
  });

  it("does not announce derived changes hidden behind a manual override", async () => {
    const id = await addService("api", base);
    await tick(db());
    await setServiceOverride(id, "operational");
    const ev = await collectEvents();
    mode = "fail";
    for (let i = 0; i < 3; i++) { await due(); await tick(db()); }
    expect(await status("api")).toBe("down"); // derived status still tracked
    await setServiceOverride(id, null);
    await until(() => ev.events.length === 1);
    expect(ev.events[0]).toMatchObject({ type: "service", slug: "api", status: "down" });
    await ev.stop();
  });

  it("never hands one due service to two workers", async () => {
    for (let i = 0; i < 40; i++) await addService(`s${i}`, base);
    const [a, b, c] = await Promise.all([claimDue(db(), 20), claimDue(db(), 20), claimDue(db(), 20)]);
    const ids = [...a, ...b, ...c].map((s) => s.id);
    expect(ids.length).toBe(40);
    expect(new Set(ids).size).toBe(40);
    expect(await claimDue(db())).toEqual([]); // all rescheduled into the future
  });

  it("prunes checks older than the retention period in batches", async () => {
    const id = await addService("api", base);
    await db().query(`INSERT INTO checks (service_id, checked_at, ok, latency_ms)
      SELECT $1, now() - make_interval(days => d) + interval '1 hour', true, 10 FROM generate_series(0, 99) d`, [id]);
    expect(await pruneChecks(db(), 30, 7)).toBe(69); // days 31..99
    expect((await db().query("SELECT count(*)::int n FROM checks")).rows[0].n).toBe(31);
  });
});
