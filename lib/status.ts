// Pure business rules: no I/O here, everything is unit-tested.

export const SERVICE_STATUSES = ["operational", "degraded", "down", "unknown"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const IMPACTS = ["minor", "major", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];

export type CheckResult = { ok: boolean; latencyMs: number };

/** Consecutive failed checks before a service is reported down. */
export const DOWN_AFTER = 3;

/**
 * Status from the most recent checks, newest first.
 * - no checks: unknown
 * - the last DOWN_AFTER checks all failed: down
 * - the last check failed (a blip, not yet confirmed): degraded
 * - the last check passed but slower than the threshold: degraded
 * - otherwise operational; one passing check is enough to recover.
 */
export function deriveStatus(recent: CheckResult[], degradedLatencyMs: number): ServiceStatus {
  if (recent.length === 0) return "unknown";
  const [last] = recent;
  if (recent.length >= DOWN_AFTER && recent.slice(0, DOWN_AFTER).every((c) => !c.ok)) return "down";
  if (!last.ok) return "degraded";
  if (last.latencyMs > degradedLatencyMs) return "degraded";
  return "operational";
}

export function effectiveStatus(derived: ServiceStatus, override: ServiceStatus | null): ServiceStatus {
  return override ?? derived;
}

const SEVERITY: Record<ServiceStatus, number> = { operational: 0, unknown: 1, degraded: 2, down: 3 };
const IMPACT_FLOOR: Record<Impact, ServiceStatus> = { minor: "operational", major: "degraded", critical: "down" };

export type Overall = "operational" | "degraded" | "outage";

/** Page banner: worst service status, raised by the impact of any open incident. */
export function overallStatus(services: ServiceStatus[], openImpacts: Impact[]): Overall {
  let worst = 0;
  for (const s of services) worst = Math.max(worst, SEVERITY[s]);
  for (const i of openImpacts) worst = Math.max(worst, SEVERITY[IMPACT_FLOOR[i]]);
  if (worst >= SEVERITY.down) return "outage";
  if (worst >= SEVERITY.degraded) return "degraded";
  return "operational";
}

/**
 * Incident lifecycle: any open status can move to any other status;
 * a resolved incident can only be reopened as investigating.
 */
export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === "resolved") return to === "investigating";
  return true;
}

/** Uptime ratio in percent with two decimals floored, so 99.999 never shows as 100.00. null when no data. */
export function uptimePercent(ok: number, total: number): number | null {
  if (total === 0) return null;
  return Math.floor((ok / total) * 10000) / 100;
}

export function isServiceStatus(v: unknown): v is ServiceStatus {
  return typeof v === "string" && (SERVICE_STATUSES as readonly string[]).includes(v);
}
export function isIncidentStatus(v: unknown): v is IncidentStatus {
  return typeof v === "string" && (INCIDENT_STATUSES as readonly string[]).includes(v);
}
export function isImpact(v: unknown): v is Impact {
  return typeof v === "string" && (IMPACTS as readonly string[]).includes(v);
}
