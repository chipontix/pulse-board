// Writes from the admin panel and the worker. Each one commits to Postgres,
// then invalidates the page cache, then publishes, in that order: a browser
// that refetches on the event must not get the old snapshot back.
import { db, tx } from "./db.ts";
import { redis } from "./redis.ts";
import { publish } from "./events.ts";
import { snapshotCache } from "./snapshot.ts";
import { canTransition, effectiveStatus, type Impact, type IncidentStatus, type ServiceStatus } from "./status.ts";

export class OpError extends Error {}

export async function createIncident(a: { title: string; impact: Impact; body: string; serviceIds: number[]; author: string }): Promise<number> {
  const id = await tx(async (c) => {
    const { rows } = await c.query<{ id: number }>("INSERT INTO incidents (title, impact) VALUES ($1, $2) RETURNING id", [a.title, a.impact]);
    const id = rows[0].id;
    if (a.serviceIds.length)
      await c.query("INSERT INTO incident_services (incident_id, service_id) SELECT $1, unnest($2::int[])", [id, a.serviceIds]);
    await c.query("INSERT INTO incident_updates (incident_id, status, body, author) VALUES ($1, 'investigating', $2, $3)", [id, a.body, a.author]);
    return id;
  });
  await changed({ type: "incident", incidentId: id });
  return id;
}

export async function addIncidentUpdate(a: { incidentId: number; status: IncidentStatus; body: string; author: string }): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ status: IncidentStatus }>("SELECT status FROM incidents WHERE id = $1 FOR UPDATE", [a.incidentId]);
    if (!rows[0]) throw new OpError("incident not found");
    if (!canTransition(rows[0].status, a.status)) throw new OpError(`cannot move a ${rows[0].status} incident to ${a.status}`);
    await c.query("INSERT INTO incident_updates (incident_id, status, body, author) VALUES ($1, $2, $3, $4)", [a.incidentId, a.status, a.body, a.author]);
    await c.query(
      "UPDATE incidents SET status = $2::incident_status, resolved_at = CASE WHEN $2::incident_status = 'resolved' THEN now() END WHERE id = $1",
      [a.incidentId, a.status],
    );
  });
  await changed({ type: "incident", incidentId: a.incidentId });
}

export async function setServiceOverride(serviceId: number, override: ServiceStatus | null): Promise<void> {
  const { rows } = await db().query<{ slug: string; status: ServiceStatus; status_override: ServiceStatus | null }>(
    `UPDATE services SET status_override = $2, status_changed_at = now() WHERE id = $1 RETURNING slug, status, status_override`,
    [serviceId, override],
  );
  if (!rows[0]) throw new OpError("service not found");
  const r = rows[0];
  await changed({ type: "service", slug: r.slug, status: effectiveStatus(r.status, r.status_override) });
}

export async function changed(e: Parameters<typeof publish>[1]): Promise<void> {
  await snapshotCache().invalidate();
  await publish(redis(), e);
}
