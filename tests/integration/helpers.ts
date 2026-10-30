import { db } from "../../lib/db.ts";
import { migrateDown, migrateUp } from "../../lib/migrate.ts";
import { newRedis, redis } from "../../lib/redis.ts";
import { CHANNEL, type PulseEvent } from "../../lib/events.ts";

if (!process.env.DATABASE_URL?.includes("test")) throw new Error("integration tests wipe the database: point DATABASE_URL at a *test* database");

/** Empty schema at the latest version and an empty Redis. */
export async function resetAll(): Promise<void> {
  await migrateDown(db(), 100);
  await migrateUp(db());
  await redis().flushall();
}

export async function addService(slug: string, url: string, extra: Record<string, unknown> = {}): Promise<number> {
  const cols = ["slug", "name", "url", ...Object.keys(extra)];
  const vals = [slug, slug.toUpperCase(), url, ...Object.values(extra)];
  const { rows } = await db().query<{ id: number }>(
    `INSERT INTO services (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals);
  return rows[0].id;
}

/** Collects events from the real channel until stop() is called. */
export async function collectEvents(): Promise<{ events: PulseEvent[]; stop: () => Promise<void> }> {
  const sub = newRedis();
  const events: PulseEvent[] = [];
  await sub.subscribe(CHANNEL);
  sub.on("message", (_c: string, raw: string) => events.push(JSON.parse(raw)));
  return { events, stop: async () => { sub.disconnect(); } };
}

export const until = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
};
