// Demo data: services pointing at the demo target, 30 days of check history,
// one resolved incident, and the admin user from ADMIN_USERNAME / ADMIN_PASSWORD.
// Idempotent: does nothing if services already exist.
import { db } from "../lib/db.ts";
import { hashPassword } from "../lib/password.ts";

const pool = db();
const target = process.env.TARGET_URL ?? "http://localhost:8081";
const interval = Number(process.env.SEED_INTERVAL_S ?? 10);
const user = process.env.ADMIN_USERNAME ?? "admin";
const pass = process.env.ADMIN_PASSWORD;
if (!pass) throw new Error("ADMIN_PASSWORD is not set (see .env.example)");

await pool.query("INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash",
  [user, await hashPassword(pass)]);

const { rows } = await pool.query("SELECT count(*)::int AS n FROM services");
if (rows[0].n > 0) {
  console.log("seed: services exist, skipping");
} else {
  const names = ["API", "Web app", "Auth", "Payments", "Search", "Webhooks"];
  for (const [i, name] of names.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await pool.query(
      "INSERT INTO services (slug, name, url, position, interval_s, timeout_ms, degraded_latency_ms) VALUES ($1, $2, $3, $4, $5, 2000, 800)",
      [slug, name, `${target}/svc/${slug}`, i, interval]);
  }
  // One check per minute per service for 30 days; ~0.05% random failures and a
  // 40-minute outage of Payments five days ago.
  await pool.query(`
    INSERT INTO checks (service_id, checked_at, ok, http_status, latency_ms, error)
    SELECT s.id, t, NOT fail, CASE WHEN fail THEN 503 ELSE 200 END, (20 + random() * 80)::int,
           CASE WHEN fail THEN 'unexpected status 503' END
    FROM services s
    CROSS JOIN generate_series(now() - interval '30 days', now() - interval '1 minute', interval '1 minute') t
    CROSS JOIN LATERAL (SELECT random() < 0.0005
      OR (s.slug = 'payments' AND t BETWEEN now() - interval '5 days' AND now() - interval '5 days' + interval '40 minutes') AS fail) f`);
  const inc = await pool.query<{ id: number }>(
    `INSERT INTO incidents (title, status, impact, created_at, resolved_at)
     VALUES ('Payments failing for card checkouts', 'resolved', 'major', now() - interval '3 days', now() - interval '3 days' + interval '35 minutes') RETURNING id`);
  const id = inc.rows[0].id;
  await pool.query("INSERT INTO incident_services SELECT $1, id FROM services WHERE slug = 'payments'", [id]);
  await pool.query(`INSERT INTO incident_updates (incident_id, status, body, author, created_at) VALUES
    ($1, 'investigating', 'Card payments are failing with a gateway timeout. We are looking into it.', 'seed', now() - interval '3 days'),
    ($1, 'identified', 'A certificate on the gateway connection expired; rotating it now.', 'seed', now() - interval '3 days' + interval '15 minutes'),
    ($1, 'resolved', 'The certificate is rotated and payments succeed again.', 'seed', now() - interval '3 days' + interval '35 minutes')`, [id]);
  const n = await pool.query("SELECT count(*)::int AS n FROM checks");
  console.log(`seed: ${names.length} services, ${n.rows[0].n} checks, 1 incident`);
}
console.log(`seed: admin user "${user}"`);
await pool.end();
