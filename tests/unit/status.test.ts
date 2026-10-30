import { describe, expect, it } from "vitest";
import { canTransition, deriveStatus, effectiveStatus, overallStatus, uptimePercent, type CheckResult } from "../../lib/status.ts";

const ok = (latencyMs = 50): CheckResult => ({ ok: true, latencyMs });
const fail: CheckResult = { ok: false, latencyMs: 2000 };

describe("deriveStatus", () => {
  it("is unknown without checks", () => expect(deriveStatus([], 500)).toBe("unknown"));
  it("is operational on a fast passing check", () => expect(deriveStatus([ok(), ok()], 500)).toBe("operational"));
  it("is degraded on a slow passing check", () => expect(deriveStatus([ok(501)], 500)).toBe("degraded"));
  it("treats latency equal to the threshold as fine", () => expect(deriveStatus([ok(500)], 500)).toBe("operational"));
  it("is degraded after one or two failures", () => {
    expect(deriveStatus([fail, ok(), ok()], 500)).toBe("degraded");
    expect(deriveStatus([fail, fail, ok()], 500)).toBe("degraded");
  });
  it("is down after three consecutive failures", () => expect(deriveStatus([fail, fail, fail], 500)).toBe("down"));
  it("is degraded, not down, with fewer than three checks recorded", () => expect(deriveStatus([fail, fail], 500)).toBe("degraded"));
  it("recovers on one passing check", () => expect(deriveStatus([ok(), fail, fail], 500)).toBe("operational"));
  it("only looks at the newest three", () => expect(deriveStatus([fail, fail, fail, ok(), ok()], 500)).toBe("down"));
});

describe("effectiveStatus", () => {
  it("follows the checks without an override", () => expect(effectiveStatus("down", null)).toBe("down"));
  it("uses the override when set", () => expect(effectiveStatus("down", "operational")).toBe("operational"));
});

describe("overallStatus", () => {
  it("is operational when everything is", () => expect(overallStatus(["operational", "operational"], [])).toBe("operational"));
  it("does not raise the banner for unknown services", () => expect(overallStatus(["operational", "unknown"], [])).toBe("operational"));
  it("takes the worst service", () => {
    expect(overallStatus(["operational", "degraded"], [])).toBe("degraded");
    expect(overallStatus(["degraded", "down"], [])).toBe("outage");
  });
  it("is raised by open incidents", () => {
    expect(overallStatus(["operational"], ["minor"])).toBe("operational");
    expect(overallStatus(["operational"], ["major"])).toBe("degraded");
    expect(overallStatus(["operational"], ["minor", "critical"])).toBe("outage");
  });
  it("handles no services", () => expect(overallStatus([], [])).toBe("operational"));
});

describe("canTransition", () => {
  it("allows any move between open statuses, including backwards", () => {
    expect(canTransition("investigating", "monitoring")).toBe(true);
    expect(canTransition("monitoring", "identified")).toBe(true);
    expect(canTransition("identified", "resolved")).toBe(true);
  });
  it("only lets a resolved incident be reopened", () => {
    expect(canTransition("resolved", "investigating")).toBe(true);
    expect(canTransition("resolved", "monitoring")).toBe(false);
    expect(canTransition("resolved", "resolved")).toBe(false);
  });
});

describe("uptimePercent", () => {
  it("is null without data", () => expect(uptimePercent(0, 0)).toBeNull());
  it("floors so near-perfect never shows 100", () => {
    expect(uptimePercent(99999, 100000)).toBe(99.99);
    expect(uptimePercent(1439, 1440)).toBe(99.93);
  });
  it("is 100 only when every check passed", () => expect(uptimePercent(10, 10)).toBe(100));
  it("is 0 when every check failed", () => expect(uptimePercent(0, 10)).toBe(0));
});
