import { subscribe } from "@/lib/events.ts";

export const dynamic = "force-dynamic";

const enc = new TextEncoder();
// A client this many chunks behind is dropped instead of buffering without bound;
// EventSource reconnects and the page resyncs.
const MAX_BACKLOG = 256;

export function GET(req: Request) {
  let cleanup: (close?: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (s: string) => {
        if ((ctrl.desiredSize ?? 0) < -MAX_BACKLOG) return cleanup(true);
        try { ctrl.enqueue(enc.encode(s)); } catch { cleanup(); }
      };
      const unsub = subscribe((raw) => send(`data: ${raw}\n\n`));
      const heartbeat = setInterval(() => send(": hb\n\n"), 15_000);
      cleanup = (close = false) => {
        unsub();
        clearInterval(heartbeat);
        if (close) try { ctrl.close(); } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup(true));
      send("retry: 2000\n: connected\n\n");
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
