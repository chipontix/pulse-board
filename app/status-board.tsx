"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { IncidentView, Snapshot } from "@/lib/snapshot.ts";
import { overallStatus, type ServiceStatus } from "@/lib/status.ts";

const OVERALL_TEXT = { operational: "All systems operational", degraded: "Some systems degraded", outage: "Major outage" };

type Live = Record<string, { status: ServiceStatus; at: number }>;

export function StatusBoard({ snap }: { snap: Snapshot }) {
  const router = useRouter();
  const [live, setLive] = useState<Live>({});
  const [conn, setConn] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const es = new EventSource("/api/stream");
    let dropped = false;
    es.onopen = () => {
      setConn("live");
      // Events sent while disconnected are gone: re-render from the server.
      if (dropped) router.refresh();
      dropped = false;
    };
    es.onerror = () => { setConn("offline"); dropped = true; };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "service") setLive((l) => ({ ...l, [e.slug]: { status: e.status, at: e.sentAt } }));
      else if (e.type === "incident") router.refresh();
    };
    return () => es.close();
  }, [router]);

  // A pushed status wins until a snapshot generated after it arrives.
  const services = snap.services.map((s) => {
    const l = live[s.slug];
    return l && l.at > snap.generatedAt ? { ...s, status: l.status } : s;
  });
  const overall = overallStatus(services.map((s) => s.status), snap.open.map((i) => i.impact));

  return (
    <main>
      <header className="top">
        <h1>Pulse Board</h1>
        <span className={`conn ${conn}`} data-testid="conn" data-state={conn}>{conn}</span>
      </header>
      <section className={`banner ${overall}`} data-testid="overall">{OVERALL_TEXT[overall]}</section>

      {snap.open.length > 0 && (
        <section>
          <h2>Active incidents</h2>
          {snap.open.map((i) => <Incident key={i.id} i={i} />)}
        </section>
      )}

      <section className="services">
        {services.map((s) => (
          <div key={s.slug} className="service" data-testid={`service-${s.slug}`}>
            <div className="row">
              <strong>{s.name}</strong>
              <span className={`pill ${s.status}`} data-testid={`status-${s.slug}`}>{s.status}</span>
            </div>
            <div className="bars" aria-label={`${s.name}, last 30 days`}>
              {s.days.map((d) => (
                <span key={d.day} className={`bar ${barClass(d.uptime)}`} title={`${d.day}: ${d.uptime === null ? "no data" : `${d.uptime}%`}`} />
              ))}
            </div>
            <div className="muted">{s.uptime24h === null ? "no checks in 24 h" : `${s.uptime24h}% uptime, last 24 h`}</div>
          </div>
        ))}
      </section>

      {snap.recent.length > 0 && (
        <section>
          <h2>Resolved in the last 7 days</h2>
          {snap.recent.map((i) => <Incident key={i.id} i={i} />)}
        </section>
      )}
      <footer className="muted">Updated {new Date(snap.generatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC · <a href="/admin">admin</a></footer>
    </main>
  );
}

function barClass(u: number | null) {
  if (u === null) return "none";
  if (u >= 99.9) return "good";
  if (u >= 99) return "warn";
  return "bad";
}

function Incident({ i }: { i: IncidentView }) {
  return (
    <article className={`incident ${i.impact}`} data-testid="incident">
      <h3>{i.title} <span className="muted">· {i.impact} · {i.status}</span></h3>
      {i.services.length > 0 && <div className="muted">Affects: {i.services.join(", ")}</div>}
      <ul>
        {i.updates.map((u, n) => (
          <li key={n}><b>{u.status}</b> — {u.body} <span className="muted">{u.createdAt.replace("T", " ").slice(0, 16)} UTC</span></li>
        ))}
      </ul>
    </article>
  );
}
