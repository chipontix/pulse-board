import pg from "pg";

const g = globalThis as { pbPool?: pg.Pool };

export function db(): pg.Pool {
  g.pbPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });
  return g.pbPool;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, pool = db()): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
