import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { redis } from "./redis.ts";
import { SESSION_COOKIE, getSession, type Session } from "./session.ts";

export async function currentAdmin(): Promise<Session | null> {
  return getSession(redis(), (await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireAdmin(): Promise<Session> {
  const s = await currentAdmin();
  if (!s) redirect("/admin/login");
  return s;
}

/** Client address for rate limiting. Next fills x-forwarded-for from the socket; a proxy in front must overwrite, not append. */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export async function requestIp(): Promise<string> {
  return clientIp(await headers());
}
