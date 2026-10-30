import { limited } from "@/lib/api.ts";
import { getSnapshot } from "@/lib/snapshot.ts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return limited(req, "api", async () => {
    const s = await getSnapshot();
    return Response.json({
      overall: s.overall,
      generatedAt: new Date(s.generatedAt).toISOString(),
      services: s.services.map(({ slug, name, status, uptime24h, statusChangedAt }) => ({ slug, name, status, uptime24h, statusChangedAt })),
      incidents: s.open,
    });
  });
}
