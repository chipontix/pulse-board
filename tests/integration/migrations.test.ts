import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db.ts";
import { migrateDown, migrateUp } from "../../lib/migrate.ts";
import "./helpers.ts";

const tables = async () =>
  (await db().query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1")).rows.map((r) => r.t);
const types = async () => (await db().query("SELECT typname FROM pg_type WHERE typname IN ('service_status', 'incident_status', 'incident_impact')")).rowCount;

describe("migrations", () => {
  afterAll(() => migrateUp(db()));

  it("go down to an empty schema and back up, and are idempotent", async () => {
    await migrateDown(db(), 100);
    expect(await tables()).toEqual([]);
    expect(await types()).toBe(0);

    expect(await migrateUp(db())).toEqual(["0001_init", "0002_check_retention"]);
    expect(await tables()).toEqual(["admins", "checks", "incident_services", "incident_updates", "incidents", "services", "subscriptions"]);
    expect(await types()).toBe(3);
    expect(await migrateUp(db())).toEqual([]);

    expect(await migrateDown(db(), 1)).toEqual(["0002_check_retention"]);
    expect(await migrateUp(db())).toEqual(["0002_check_retention"]);
  });

  it("serialise concurrent runners on the advisory lock", async () => {
    await migrateDown(db(), 100);
    const [a, b] = await Promise.all([migrateUp(db()), migrateUp(db())]);
    expect([...a, ...b].sort()).toEqual(["0001_init", "0002_check_retention"]);
  });

  it("keep the query plans on the indexes the README promises", async () => {
    const plan = async (sql: string) => JSON.stringify((await db().query(`EXPLAIN (FORMAT JSON) ${sql}`)).rows);
    await db().query("SET enable_seqscan = off"); // empty tables: force the planner to show its index choice
    try {
      expect(await plan("SELECT count(*) FILTER (WHERE ok) FROM checks WHERE service_id = 1 AND checked_at >= now() - interval '1 day'")).toContain("checks_service_time_idx");
      expect(await plan("SELECT id FROM incidents WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 20")).toContain("incidents_open_idx");
      expect(await plan("SELECT id FROM services WHERE next_check_at <= now() ORDER BY next_check_at LIMIT 50")).toContain("services_next_check_idx");
    } finally {
      await db().query("RESET enable_seqscan");
    }
  });
});
