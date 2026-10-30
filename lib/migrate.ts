import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const DIR = path.join(import.meta.dirname, "..", "migrations");
const LOCK = 7_042_001; // pg_advisory_lock key, one migrator at a time

async function versions(): Promise<string[]> {
  const files = await readdir(DIR);
  return files.filter((f) => f.endsWith(".up.sql")).map((f) => f.slice(0, -".up.sql".length)).sort();
}

async function withLock<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock($1)", [LOCK]);
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    return await fn(c);
  } finally {
    await c.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    c.release();
  }
}

async function applied(c: pg.PoolClient): Promise<string[]> {
  const r = await c.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
  return r.rows.map((x) => x.version);
}

async function run(c: pg.PoolClient, file: string, record: string, args: string[]) {
  const sql = await readFile(path.join(DIR, file), "utf8");
  await c.query("BEGIN");
  try {
    await c.query(sql);
    await c.query(record, args);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Applies every pending migration, each in its own transaction. Returns the versions applied. */
export function migrateUp(pool: pg.Pool): Promise<string[]> {
  return withLock(pool, async (c) => {
    const done = new Set(await applied(c));
    const todo = (await versions()).filter((v) => !done.has(v));
    for (const v of todo) await run(c, `${v}.up.sql`, "INSERT INTO schema_migrations (version) VALUES ($1)", [v]);
    return todo;
  });
}

/** Reverts the last `steps` applied migrations, newest first. Returns the versions reverted. */
export function migrateDown(pool: pg.Pool, steps = 1): Promise<string[]> {
  return withLock(pool, async (c) => {
    const todo = (await applied(c)).reverse().slice(0, steps);
    for (const v of todo) await run(c, `${v}.down.sql`, "DELETE FROM schema_migrations WHERE version = $1", [v]);
    return todo;
  });
}
