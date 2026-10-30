export type ProbeTarget = { url: string; timeoutMs: number; expectedStatus: number };
export type ProbeResult = { ok: boolean; httpStatus: number | null; latencyMs: number; error: string | null };

/** One HTTP GET. ok = expected status within the timeout; the body is drained, not read. */
export async function probe(t: ProbeTarget): Promise<ProbeResult> {
  const start = performance.now();
  try {
    const res = await fetch(t.url, { signal: AbortSignal.timeout(t.timeoutMs), redirect: "manual", headers: { "user-agent": "pulse-board-probe" } });
    await res.body?.cancel();
    const latencyMs = Math.round(performance.now() - start);
    const ok = res.status === t.expectedStatus;
    return { ok, httpStatus: res.status, latencyMs, error: ok ? null : `unexpected status ${res.status}` };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - start);
    const err = e as Error;
    return { ok: false, httpStatus: null, latencyMs, error: err.name === "TimeoutError" ? `timeout after ${t.timeoutMs} ms` : String(err.cause ?? err.message) };
  }
}
