import { db } from "./db.ts";
import { redis } from "./redis.ts";
import { SwrCache } from "./cache.ts";
import { effectiveStatus, overallStatus, uptimePercent, type Impact, type IncidentStatus, type Overall, type ServiceStatus } from "./status.ts";

export const HISTORY_DAYS = 30;

export type ServiceView = {
  id: number;
  slug: string;
  name: string;
  status: ServiceStatus;
  overridden: boolean;
  statusChangedAt: string;
  uptime24h: number | null;
  /** oldest first, HISTORY_DAYS entries, null = no checks that day */
  days: { day: string; uptime: number | null }[];
};

export type IncidentView = {
  id: number;
  title: string;
  status: IncidentStatus;
  impact: Impact;
  createdAt: string;
  resolvedAt: string | null;
  services: string[];
  updates: { status: IncidentStatus; body: string; createdAt: string }[];
};

export type Snapshot = {
  generatedAt: number;
  overall: Overall;
  services: ServiceView[];
  open: IncidentView[];
  recent: IncidentView[];
};

const SERVICES_SQL = `
SELECT s.id, s.slug, s.name, s.status, s.status_override, s.status_changed_at,
       coalesce(d24.ok, 0) AS ok24, coalesce(d24.total, 0) AS total24, days.days
FROM services s
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE ok)::int AS ok, count(*)::int AS total
  FROM checks c WHERE c.service_id = s.id AND c.checked_at >= now() - interval '24 hours'
) d24
CROSS JOIN LATERAL (
  SELECT coalesce(json_agg(json_build_object('day', day, 'ok', ok, 'total', total)), '[]') AS days
  FROM (
    SELECT (c.checked_at AT TIME ZONE 'UTC')::date AS day,
           count(*) FILTER (WHERE ok)::int AS ok, count(*)::int AS total
    FROM checks c
    WHERE c.service_id = s.id
      AND c.checked_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $1 - 1)) AT TIME ZONE 'UTC'
    GROUP BY 1
  ) d
) days
ORDER BY s.position, s.id`;

const INCIDENT_COLS = `
  i.id, i.title, i.status, i.impact, i.created_at, i.resolved_at,
  coalesce((SELECT json_agg(s.name ORDER BY s.position, s.id) FROM incident_services x JOIN services s ON s.id = x.service_id
            WHERE x.incident_id = i.id), '[]') AS services,
  coalesce((SELECT json_agg(json_build_object('status', u.status, 'body', u.body, 'createdAt', u.created_at) ORDER BY u.created_at DESC, u.id DESC)
            FROM incident_updates u WHERE u.incident_id = i.id), '[]') AS updates`;

type IncidentRow = {
  id: number; title: string; status: IncidentStatus; impact: Impact; created_at: Date; resolved_at: Date | null;
  services: string[]; updates: IncidentView["updates"];
};

function toIncident(r: IncidentRow): IncidentView {
  return {
    id: r.id, title: r.title, status: r.status, impact: r.impact,
    createdAt: r.created_at.toISOString(), resolvedAt: r.resolved_at?.toISOString() ?? null,
    services: r.services, updates: r.updates,
  };
}

function lastDays(now: Date): string[] {
  const out: string[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Everything the public page shows, straight from Postgres. */
export async function loadSnapshot(): Promise<Snapshot> {
  const pool = db();
  const [svc, open, recent] = await Promise.all([
    pool.query(SERVICES_SQL, [HISTORY_DAYS]),
    pool.query<IncidentRow>(`SELECT ${INCIDENT_COLS} FROM incidents i WHERE i.resolved_at IS NULL ORDER BY i.created_at DESC LIMIT 20`),
    pool.query<IncidentRow>(`SELECT ${INCIDENT_COLS} FROM incidents i WHERE i.resolved_at >= now() - interval '7 days' ORDER BY i.resolved_at DESC LIMIT 20`),
  ]);
  const dayKeys = lastDays(new Date());
  const services: ServiceView[] = svc.rows.map((r) => {
    const byDay = new Map<string, { ok: number; total: number }>((r.days as { day: string; ok: number; total: number }[]).map((d) => [d.day, d]));
    return {
      id: r.id, slug: r.slug, name: r.name,
      status: effectiveStatus(r.status, r.status_override),
      overridden: r.status_override !== null,
      statusChangedAt: (r.status_changed_at as Date).toISOString(),
      uptime24h: uptimePercent(r.ok24, r.total24),
      days: dayKeys.map((day) => ({ day, uptime: uptimePercent(byDay.get(day)?.ok ?? 0, byDay.get(day)?.total ?? 0) })),
    };
  });
  const openIncidents = open.rows.map(toIncident);
  return {
    generatedAt: Date.now(),
    overall: overallStatus(services.map((s) => s.status), openIncidents.map((i) => i.impact)),
    services,
    open: openIncidents,
    recent: recent.rows.map(toIncident),
  };
}

const g = globalThis as { pbSnapshotCache?: SwrCache<Snapshot> };

export function snapshotCache(): SwrCache<Snapshot> {
  g.pbSnapshotCache ??= new SwrCache(redis(), "pb:snapshot:v1", loadSnapshot, {
    freshMs: Number(process.env.CACHE_FRESH_MS ?? 5000),
    staleMs: Number(process.env.CACHE_STALE_MS ?? 60000),
  });
  return g.pbSnapshotCache;
}

/** The public page and API read through this. CACHE_DISABLED=1 is for the with/without benchmark. */
export async function getSnapshot(): Promise<Snapshot> {
  if (process.env.CACHE_DISABLED === "1") return loadSnapshot();
  return (await snapshotCache().get()).value;
}
