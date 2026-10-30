// node bench/sse.ts [--url http://edge/api/stream] [--clients 100,500,...] [--events 20] [--every-ms 500]
// For each client count: open N SSE streams, wait until all are connected, then
// publish bench events straight to the Redis channel, stamped with this
// process's monotonic clock (performance.now(), immune to the VM's wall-clock
// steps), and record, per stream and event, receive time - send time.
// Same process sends and receives, so there is no clock skew in the numbers.
import http from "node:http";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { publish } from "../lib/events.ts";
import { redis } from "../lib/redis.ts";
import { pct } from "./stats.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://edge/api/stream" },
    clients: { type: "string", default: "500,1000,1500,2000,2500,3000,4000,5000,6000,8000" },
    events: { type: "string", default: "20" },
    "every-ms": { type: "string", default: "500" },
    "budget-ms": { type: "string", default: "500" },
    out: { type: "string", default: "sse" },
  },
});
const EVENTS = Number(values.events);
const BUDGET = Number(values["budget-ms"]);
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Conn = { req: http.ClientRequest; got: number };

function connect(lat: number[], onReady: () => void, onFail: (e: Error) => void): Conn {
  const c: Conn = { req: null as unknown as http.ClientRequest, got: 0 };
  c.req = http.get(values.url!, { agent }, (res) => {
    if (res.statusCode !== 200) return onFail(new Error(`status ${res.statusCode}`));
    let buf = "";
    let ready = false;
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      const now = performance.now();
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!ready && frame.includes(": connected")) { ready = true; onReady(); }
        if (frame.startsWith("data: ")) {
          const e = JSON.parse(frame.slice(6));
          if (e.type === "bench") { lat.push(Math.round(now - e.mono)); c.got++; }
        }
      }
    });
    res.on("error", () => {});
  });
  c.req.on("error", onFail);
  return c;
}

async function round(n: number) {
  const lat: number[] = [];
  let ready = 0, failed = 0;
  const t0 = Date.now();
  const conns: Conn[] = [];
  for (let i = 0; i < n; i++) {
    conns.push(connect(lat, () => ready++, () => failed++));
    if (i % 200 === 199) await sleep(50); // ramp, don't SYN-flood the edge
  }
  while (ready + failed < n && Date.now() - t0 < 120_000) await sleep(50);
  const connectS = (Date.now() - t0) / 1000;
  if (failed === 0 && ready === n) {
    await sleep(1000);
    for (let seq = 0; seq < EVENTS; seq++) {
      await publish(redis(), { type: "bench", seq, mono: performance.now() });
      await sleep(Number(values["every-ms"]));
    }
    await sleep(3000); // grace for stragglers
  }
  for (const c of conns) c.req.destroy();
  const expected = n * EVENTS;
  const r = {
    clients: n, connected: ready, failed, connectS,
    expected, delivered: lat.length, deliveredPct: Math.round((lat.length / expected) * 10000) / 100,
    p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.length ? Math.max(...lat) : NaN,
  };
  return { ...r, withinBudget: failed === 0 && lat.length === expected && r.p95 < BUDGET };
}

const rows = [];
for (const n of values.clients!.split(",").map(Number)) {
  const r = await round(n);
  rows.push(r);
  console.log(JSON.stringify(r));
  await sleep(5000); // let the server drop the old streams
  if (!r.withinBudget) break;
}
const best = rows.filter((r) => r.withinBudget).at(-1);
console.log(`\nbudget: p95 < ${BUDGET} ms and 100% delivered; ${EVENTS} events, one per ${values["every-ms"]} ms`);
console.log("clients  connected  delivered%   p50   p95   p99    max (ms)  within budget");
for (const r of rows)
  console.log(`${String(r.clients).padStart(7)}  ${String(r.connected).padStart(9)}  ${String(r.deliveredPct).padStart(10)}  ${[r.p50, r.p95, r.p99, r.max].map((x) => String(x).padStart(5)).join(" ")}       ${r.withinBudget ? "yes" : "NO"}`);
console.log(`\nlargest client count within budget: ${best?.clients ?? "none"}`);
writeFileSync(`results/${values.out}.json`, JSON.stringify({ budgetMs: BUDGET, events: EVENTS, everyMs: Number(values["every-ms"]), rows, largestWithinBudget: best?.clients ?? null }, null, 2));
redis().disconnect();
process.exit(0);
