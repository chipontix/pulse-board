// node bench/page.ts <label> [--url http://edge/] [--duration 30] [--connections 50] [--invalidate-ms N]
// Closed-loop load on the public page with autocannon; p50/p95/p99 from every
// response time (autocannon's own table has no p95), and the cache counters
// from Redis over exactly the measured window.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import autocannon from "autocannon";
import { db } from "../lib/db.ts";
import { loadSnapshot, snapshotCache } from "../lib/snapshot.ts";
import { redis } from "../lib/redis.ts";
import { pct } from "./stats.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://edge/" },
    duration: { type: "string", default: "30" },
    connections: { type: "string", default: "50" },
    warmup: { type: "string", default: "5" },
    "invalidate-ms": { type: "string" },
  },
});
const label = positionals[0] ?? "run";
// one decimal, never rounded up
const floor1 = (x: number) => Math.floor(x * 10) / 10;
const cache = snapshotCache();

const run = (duration: number, onResponse?: (ms: number) => void) => new Promise<autocannon.Result>((ok, fail) => {
  const inst = autocannon({ url: values.url!, connections: Number(values.connections), duration }, (e, r) => (e ? fail(e) : ok(r)));
  if (onResponse) inst.on("response", (_c: unknown, code: number, _b: number, ms: number) => { if (code === 200) onResponse(ms); });
});

// The Postgres side of one page view, measured alone: 30 sequential snapshot loads.
const direct: number[] = [];
for (let i = 0; i < 30; i++) {
  const t = performance.now();
  await loadSnapshot();
  direct.push(performance.now() - t);
}
const xacts = async () => Number((await db().query("SELECT xact_commit + xact_rollback AS n FROM pg_stat_database WHERE datname = current_database()")).rows[0].n);

await run(Number(values.warmup));
await cache.resetStats();
const x0 = await xacts();

let invalidations = 0;
const timer = values["invalidate-ms"]
  ? setInterval(() => { invalidations++; void cache.invalidate(); }, Number(values["invalidate-ms"]))
  : undefined;
const lat: number[] = [];
const r = await run(Number(values.duration), (ms) => lat.push(ms));
clearInterval(timer);
const pgXacts = (await xacts()) - x0;
const s = await cache.stats();
const lookups = s.fresh + s.stale + s.miss;

const out = {
  label, url: values.url, connections: Number(values.connections), durationS: Number(values.duration),
  requests: r.requests.total, non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts,
  reqPerSec: floor1(r.requests.total / Number(values.duration)),
  latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: Math.max(...lat), samples: lat.length },
  cache: { ...s, lookups, hitRate: lookups ? (s.fresh + s.stale) / lookups : null, invalidations },
  // includes the worker's few transactions per second and this script's two reads
  postgres: { transactions: pgXacts, perSecond: floor1(pgXacts / Number(values.duration)) },
  snapshotQueryAloneMs: { p50: pct(direct, 50), p95: pct(direct, 95), samples: direct.length },
};
const text = autocannon.printResult(r) + "\n" + JSON.stringify(out, null, 2) + "\n";
process.stdout.write(text);
writeFileSync(`results/page-${label}.json`, JSON.stringify({ ...out, autocannon: r }, null, 2));
redis().disconnect();
await db().end();
