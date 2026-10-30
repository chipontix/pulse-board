// node bench/summary.ts > results/SUMMARY.md — the README tables, generated from results/*.json.
import { readFileSync, readdirSync } from "node:fs";

const dir = "results";
const json = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
const files = readdirSync(dir).sort();
const r1 = (x: number) => x.toFixed(1);
// rates and ratios: one decimal, truncated, so a bound is never rounded up
const f1 = (x: number) => (Math.floor(x * 10) / 10).toFixed(1);
const rps = (r: { requests: number; durationS: number }) => r.requests / r.durationS;
const pgps = (r: { postgres: { transactions: number }; durationS: number }) => r.postgres.transactions / r.durationS;
const range = (xs: number[], f = (x: number) => String(x)) => {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
};

console.log("## Public page (autocannon, 50 connections, 30 s per run)\n");
console.log("| mode | runs | req/s | p50 ms | p95 ms | p99 ms | cache hit rate | Postgres tx/s | non-2xx |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const mode of ["nocache", "cache", "cache-invalidate-1s"]) {
  const runs = files.filter((f) => new RegExp(`^page-${mode}-r\\d+\\.json$`).test(f)).map(json);
  if (!runs.length) continue;
  const hit = runs.map((r) => r.cache.hitRate).filter((x) => x !== null);
  console.log(`| ${mode} | ${runs.length} | ${range(runs.map(rps), f1)} | ${range(runs.map((r) => r.latencyMs.p50), r1)} | ${range(runs.map((r) => r.latencyMs.p95), r1)} | ${range(runs.map((r) => r.latencyMs.p99), r1)} | ${hit.length ? range(hit, (x) => `${(x * 100).toFixed(2)}%`) : "n/a (cache off)"} | ${range(runs.map(pgps), f1)} | ${runs.reduce((a, r) => a + r.non2xx, 0)} |`);
}
// Interleaved runs: compare repetition k of each mode with repetition k of no-cache.
const rep = (mode: string) => files.filter((f) => new RegExp(`^page-${mode}-r\\d+\\.json$`).test(f)).map(json);
const [off, on] = [rep("nocache"), rep("cache")];
if (off.length && off.length === on.length) {
  const thr = on.map((r, i) => r.requests / off[i].requests);
  const p95 = on.map((r, i) => off[i].latencyMs.p95 / r.latencyMs.p95);
  console.log(`\nCache on vs off, same repetition (raw request counts and p95): throughput ×${range(thr, f1)}, p95 ÷${range(p95, f1)}.`);
}
const direct = files.filter((f) => /^page-.*-r\d+\.json$/.test(f)).map(json).map((r) => r.snapshotQueryAloneMs);
console.log(`\nSnapshot queries alone (30 sequential loads before each run): p50 ${range(direct.map((d) => d.p50), r1)} ms, p95 ${range(direct.map((d) => d.p95), r1)} ms.\n`);

const sse = files.filter((f) => /^sse-r\d+\.json$/.test(f)).map(json);
if (sse.length) {
  console.log(`## SSE fan-out (budget p95 < ${sse[0].budgetMs} ms and 100% delivered; ${sse[0].events} events, one per ${sse[0].everyMs} ms)\n`);
  console.log("| run | clients | delivered | p50 ms | p95 ms | p99 ms | max ms | within budget |");
  console.log("|---|---|---|---|---|---|---|---|");
  sse.forEach((s, i) => {
    for (const r of s.rows) console.log(`| r${i + 1} | ${r.clients} | ${r.deliveredPct}% | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.withinBudget ? "yes" : "**no**"} |`);
  });
  console.log(`\nLargest client count within budget per run: ${sse.map((s) => s.largestWithinBudget).join(", ")}.`);
}
