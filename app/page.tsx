import { getSnapshot } from "@/lib/snapshot.ts";
import { StatusBoard } from "./status-board.tsx";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <StatusBoard snap={await getSnapshot()} />;
}
