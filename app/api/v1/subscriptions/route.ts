import { randomBytes } from "node:crypto";
import { limited } from "@/lib/api.ts";
import { db } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** POST {email, service?}: subscribe to all services or one by slug. The token is for the unsubscribe link of a notification email (not sent yet). */
export function POST(req: Request) {
  return limited(req, "subscribe", async () => {
    const body = (await req.json().catch(() => null)) as { email?: unknown; service?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!EMAIL.test(email) || email.length > 254) return Response.json({ error: "invalid email" }, { status: 400 });
    let serviceId: number | null = null;
    if (body?.service !== undefined) {
      const r = await db().query<{ id: number }>("SELECT id FROM services WHERE slug = $1", [String(body.service)]);
      if (!r.rows[0]) return Response.json({ error: "unknown service" }, { status: 404 });
      serviceId = r.rows[0].id;
    }
    const token = randomBytes(24).toString("base64url");
    await db().query(
      `INSERT INTO subscriptions (email, service_id, token) VALUES ($1, $2, $3)
       ON CONFLICT (lower(email), coalesce(service_id, 0)) DO NOTHING`,
      [email, serviceId, token]);
    // Same answer whether or not the address was already subscribed: no enumeration.
    return Response.json({ subscribed: true }, { status: 202 });
  });
}

/** DELETE ?token=...: unsubscribe. */
export function DELETE(req: Request) {
  return limited(req, "subscribe", async () => {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const r = await db().query("DELETE FROM subscriptions WHERE token = $1", [token]);
    return new Response(null, { status: r.rowCount ? 204 : 404 });
  });
}
