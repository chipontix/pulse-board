"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestIp, requireAdmin } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { OpError, addIncidentUpdate, createIncident, setServiceOverride } from "@/lib/ops.ts";
import { verifyPassword } from "@/lib/password.ts";
import { rateLimit } from "@/lib/ratelimit.ts";
import { redis } from "@/lib/redis.ts";
import { SESSION_COOKIE, SESSION_TTL_S, createSession, destroySession } from "@/lib/session.ts";
import { isImpact, isIncidentStatus, isServiceStatus } from "@/lib/status.ts";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function login(form: FormData) {
  const username = str(form, "username");
  // 10 attempts per 15 minutes per address and username, against guessing.
  const rl = await rateLimit(redis(), `login:${await requestIp()}:${username}`, 10, 15 * 60_000);
  if (!rl.allowed) redirect("/admin/login?error=too-many-attempts");
  const { rows } = await db().query<{ id: number; password_hash: string }>("SELECT id, password_hash FROM admins WHERE username = $1", [username]);
  if (!rows[0] || !(await verifyPassword(str(form, "password"), rows[0].password_hash))) redirect("/admin/login?error=invalid");
  const id = await createSession(redis(), { adminId: rows[0].id, username });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_S, secure: process.env.COOKIE_SECURE === "1",
  });
  redirect("/admin");
}

export async function logout() {
  const jar = await cookies();
  await destroySession(redis(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

async function guarded(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof OpError) redirect(`/admin?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/admin");
}

export async function createIncidentAction(form: FormData) {
  const admin = await requireAdmin();
  const title = str(form, "title"), body = str(form, "body"), impact = str(form, "impact");
  if (!title || !body || !isImpact(impact)) redirect("/admin?error=title%2C%20message%20and%20impact%20are%20required");
  const serviceIds = form.getAll("services").map(Number).filter(Number.isInteger);
  await guarded(() => createIncident({ title, impact, body, serviceIds, author: admin.username }).then(() => {}));
}

export async function addUpdateAction(form: FormData) {
  const admin = await requireAdmin();
  const status = str(form, "status"), body = str(form, "body");
  if (!body || !isIncidentStatus(status)) redirect("/admin?error=status%20and%20message%20are%20required");
  const incidentId = Number(form.get("incidentId"));
  if (!Number.isInteger(incidentId)) redirect("/admin?error=bad%20incident");
  await guarded(() => addIncidentUpdate({ incidentId, status, body, author: admin.username }));
}

export async function setOverrideAction(form: FormData) {
  await requireAdmin();
  const v = str(form, "override");
  const override = v === "" ? null : isServiceStatus(v) ? v : undefined;
  const serviceId = Number(form.get("serviceId"));
  if (override === undefined || !Number.isInteger(serviceId)) redirect("/admin?error=bad%20request");
  await guarded(() => setServiceOverride(serviceId, override));
}
