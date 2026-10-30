import { db } from "../lib/db.ts";
import { pruneChecks, tick } from "./run.ts";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 500);
const RETENTION_DAYS = Number(process.env.CHECK_RETENTION_DAYS ?? 90);
let lastPrune = 0;
let running = true;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { running = false; });

console.log(`worker: polling every ${POLL_MS} ms`);
while (running) {
  try {
    await tick(db(), (m) => console.log(`worker: ${m}`));
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      const n = await pruneChecks(db(), RETENTION_DAYS);
      if (n) console.log(`worker: pruned ${n} checks older than ${RETENTION_DAYS} days`);
    }
  } catch (e) {
    console.error("worker: tick failed", e);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
await db().end();
process.exit(0);
