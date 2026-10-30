import { db } from "@/lib/db.ts";
import { redis } from "@/lib/redis.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  await Promise.all([db().query("SELECT 1"), redis().ping()]);
  return Response.json({ ok: true });
}
