import type pg from "pg";
import { tx } from "../lib/db.ts";
import { changed } from "../lib/ops.ts";
import { DOWN_AFTER, deriveStatus, effectiveStatus, type ServiceStatus } from "../lib/status.ts";
import { probe, type ProbeResult } from "./probe.ts";

type DueService = {
  id: number; slug: string; url: string; timeout_ms: number; expected_status: number;
  degraded_latency_ms: number;
};

/**
 * Claims due services and schedules their next check in one statement.
 * SKIP LOCKED lets several workers share the table without probing a service twice.
 */
export async function claimDue(pool: pg.Pool, limit = 50): Promise<DueService[]> {
  const { rows } = await pool.query<DueService>(
    `UPDATE services s SET next_check_at = now() + make_interval(secs => s.interval_s)
     WHERE s.id IN (SELECT id FROM services WHERE next_check_at <= now() ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING s.id, s.slug, s.url, s.timeout_ms, s.expected_status, s.degraded_latency_ms`,
    [limit],
  );
  return rows;
}

/**
 * Stores one check and re-derives the service status from the last DOWN_AFTER checks.
 * Returns the new effective status if it changed, else null.
 */
export async function recordCheck(pool: pg.Pool, svc: DueService, r: ProbeResult): Promise<ServiceStatus | null> {
  return tx(async (c) => {
    const cur = await c.query<{ status: ServiceStatus; status_override: ServiceStatus | null }>(
      "SELECT status, status_override FROM services WHERE id = $1 FOR UPDATE", [svc.id]);
    if (!cur.rows[0]) return null; // deleted meanwhile
    await c.query("INSERT INTO checks (service_id, ok, http_status, latency_ms, error) VALUES ($1, $2, $3, $4, $5)",
      [svc.id, r.ok, r.httpStatus, r.latencyMs, r.error]);
    const recent = await c.query<{ ok: boolean; latency_ms: number }>(
      "SELECT ok, latency_ms FROM checks WHERE service_id = $1 ORDER BY checked_at DESC, id DESC LIMIT $2", [svc.id, DOWN_AFTER]);
    const derived = deriveStatus(recent.rows.map((x) => ({ ok: x.ok, latencyMs: x.latency_ms })), svc.degraded_latency_ms);
    const { status: before, status_override: override } = cur.rows[0];
    if (derived === before) return null;
    await c.query("UPDATE services SET status = $2, status_changed_at = now() WHERE id = $1", [svc.id, derived]);
    // With a manual override in place the page does not change, so nothing to announce.
    if (override !== null) return null;
    return effectiveStatus(derived, null);
  }, pool);
}

/** One pass: probe everything due, concurrently. Returns how many services were probed. */
export async function tick(pool: pg.Pool, log: (m: string) => void = () => {}): Promise<number> {
  const due = await claimDue(pool);
  await Promise.all(due.map(async (s) => {
    const r = await probe({ url: s.url, timeoutMs: s.timeout_ms, expectedStatus: s.expected_status });
    const next = await recordCheck(pool, s, r);
    if (next) {
      log(`${s.slug} -> ${next}`);
      await changed({ type: "service", slug: s.slug, status: next });
    }
  }));
  return due.length;
}

/** Deletes checks older than the retention period, in batches so no single statement holds locks for long. */
export async function pruneChecks(pool: pg.Pool, retentionDays: number, batch = 10_000): Promise<number> {
  let total = 0;
  for (;;) {
    const r = await pool.query(
      `DELETE FROM checks WHERE id IN (SELECT id FROM checks WHERE checked_at < now() - make_interval(days => $1) LIMIT $2)`,
      [retentionDays, batch]);
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < batch) return total;
  }
}
