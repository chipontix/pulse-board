// The thing being monitored in the demo and in e2e: GET /svc/<name> answers
// 200, 503 or slowly, depending on a mode switched with POST /svc/<name>/<ok|fail|slow>.
import { createServer } from "node:http";

const modes = new Map<string, string>();
const port = Number(process.env.PORT ?? 8081);

createServer((req, res) => {
  const m = req.url?.match(/^\/svc\/([a-z0-9-]+)(?:\/(ok|fail|slow))?$/);
  if (!m) { res.writeHead(404).end(); return; }
  const [, name, mode] = m;
  if (req.method === "POST" && mode) {
    modes.set(name, mode);
    res.writeHead(200).end(`${name}: ${mode}\n`);
    return;
  }
  const cur = modes.get(name) ?? "ok";
  if (cur === "fail") res.writeHead(503).end("down\n");
  else if (cur === "slow") setTimeout(() => res.writeHead(200).end("ok\n"), 1200);
  else res.writeHead(200).end("ok\n");
}).listen(port, () => console.log(`demo-target on :${port}`));
