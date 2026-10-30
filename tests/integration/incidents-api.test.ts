import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db.ts";
import { OpError, addIncidentUpdate, createIncident, setServiceOverride } from "../../lib/ops.ts";
import { getSnapshot } from "../../lib/snapshot.ts";
import { GET as statusApi } from "../../app/api/v1/status/route.ts";
import { DELETE as unsubscribe, POST as subscribe } from "../../app/api/v1/subscriptions/route.ts";
import { GET as stream } from "../../app/api/stream/route.ts";
import { addService, collectEvents, resetAll, until } from "./helpers.ts";

beforeEach(resetAll);

describe("incidents through the cached snapshot", () => {
  it("shows a new incident at once, moves it to recent on resolve, and refuses an invalid transition", async () => {
    const api = await addService("api", "http://x");
    await addService("auth", "http://x");
    expect((await getSnapshot()).open).toEqual([]); // cached now

    const ev = await collectEvents();
    const id = await createIncident({ title: "Login errors", impact: "critical", body: "Looking", serviceIds: [api], author: "t" });
    let s = await getSnapshot();
    expect(s.open).toHaveLength(1);
    expect(s.open[0]).toMatchObject({ title: "Login errors", status: "investigating", services: ["API"] });
    expect(s.overall).toBe("outage");

    await addIncidentUpdate({ incidentId: id, status: "resolved", body: "Fixed", author: "t" });
    s = await getSnapshot();
    expect(s.open).toEqual([]);
    expect(s.recent[0].updates.map((u) => u.status)).toEqual(["resolved", "investigating"]);
    expect(s.overall).toBe("operational");

    await expect(addIncidentUpdate({ incidentId: id, status: "monitoring", body: "x", author: "t" })).rejects.toBeInstanceOf(OpError);
    await expect(addIncidentUpdate({ incidentId: 999, status: "monitoring", body: "x", author: "t" })).rejects.toThrow("not found");
    await until(() => ev.events.length === 2);
    expect(ev.events.map((e) => e.type)).toEqual(["incident", "incident"]);
    await ev.stop();
  });

  it("keeps the resolved_at invariant in the database", async () => {
    await expect(db().query("INSERT INTO incidents (title, status) VALUES ('x', 'resolved')")).rejects.toThrow(/check constraint/);
  });

  it("applies a manual override to the snapshot", async () => {
    const id = await addService("api", "http://x");
    await getSnapshot();
    await setServiceOverride(id, "down");
    const s = await getSnapshot();
    expect(s.services[0]).toMatchObject({ status: "down", overridden: true });
  });

  it("computes 24 h uptime and 30 daily bars from checks", async () => {
    const id = await addService("api", "http://x");
    await db().query(`INSERT INTO checks (service_id, checked_at, ok, latency_ms)
      SELECT $1, now() - make_interval(mins => m), m % 100 <> 0, 10 FROM generate_series(1, 1000) m`, [id]);
    const [svc] = (await getSnapshot()).services;
    expect(svc.uptime24h).toBe(99); // 10 of 1000 failed
    expect(svc.days).toHaveLength(30);
    expect(svc.days.slice(0, 27).every((d) => d.uptime === null)).toBe(true);
  });
});

describe("public API", () => {
  const req = (ip: string, init?: RequestInit, url = "http://t/api/v1/status") => new Request(url, { ...init, headers: { "x-forwarded-for": ip, ...init?.headers } });

  it("serves the snapshot and rate-limits per client address", async () => {
    await addService("api", "http://x");
    const limit = Number(process.env.API_RATE_LIMIT);
    for (let i = 0; i < limit; i++) expect((await statusApi(req("1.1.1.1"))).status).toBe(200);
    const refused = await statusApi(req("1.1.1.1"));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const other = await statusApi(req("2.2.2.2"));
    expect(other.status).toBe(200);
    expect(other.headers.get("x-ratelimit-remaining")).toBe(String(limit - 1));
    expect((await other.json()).services[0]).toMatchObject({ slug: "api", status: "unknown" });
  });

  it("subscribes once per address and service, without telling whether it existed", async () => {
    await addService("api", "http://x");
    const post = (body: unknown) => subscribe(req("3.3.3.3", { method: "POST", body: JSON.stringify(body) }, "http://t/api/v1/subscriptions"));
    expect((await post({ email: "a@example.com" })).status).toBe(202);
    expect((await post({ email: "A@example.com" })).status).toBe(202);
    expect((await post({ email: "a@example.com", service: "api" })).status).toBe(202);
    expect((await post({ email: "nope" })).status).toBe(400);
    expect((await post({ email: "a@example.com", service: "nope" })).status).toBe(404);
    const rows = (await db().query("SELECT token FROM subscriptions")).rows;
    expect(rows).toHaveLength(2);
    const del = (t: string) => unsubscribe(req("3.3.3.4", { method: "DELETE" }, `http://t/api/v1/subscriptions?token=${t}`));
    expect((await del(rows[0].token)).status).toBe(204);
    expect((await del(rows[0].token)).status).toBe(404);
  });
});

describe("SSE stream", () => {
  it("delivers published events to every open stream and unsubscribes on abort", async () => {
    const { listenerCount } = await import("../../lib/events.ts");
    const open = () => {
      const ac = new AbortController();
      const res = stream(new Request("http://t/api/stream", { signal: ac.signal }));
      return { ac, res, reader: res.body!.pipeThrough(new TextDecoderStream()).getReader() };
    };
    const a = open(), b = open();
    expect(a.res.headers.get("content-type")).toContain("text/event-stream");
    expect((await a.reader.read()).value).toContain(": connected");
    await b.reader.read();
    expect(listenerCount()).toBe(2);

    const id = await addService("api", "http://x");
    await new Promise((r) => setTimeout(r, 100)); // the hub's SUBSCRIBE is asynchronous
    await setServiceOverride(id, "degraded");
    for (const s of [a, b]) {
      const { value } = await s.reader.read();
      expect(value).toMatch(/^data: \{"type":"service","slug":"api","status":"degraded","sentAt":\d+\}\n\n$/);
    }
    a.ac.abort();
    b.ac.abort();
    expect(listenerCount()).toBe(0);
  });
});
