import { requireAdmin } from "@/lib/auth.ts";
import { loadSnapshot } from "@/lib/snapshot.ts";
import { IMPACTS, INCIDENT_STATUSES, SERVICE_STATUSES } from "@/lib/status.ts";
import { addUpdateAction, createIncidentAction, logout, setOverrideAction } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const snap = await loadSnapshot(); // admins always read Postgres, never the cache

  return (
    <main>
      <header className="top">
        <h1>Admin</h1>
        <form action={logout} className="inline"><span className="muted">{admin.username}</span><button>Sign out</button></form>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <h2>New incident</h2>
      <form action={createIncidentAction} className="card">
        <label>Title <input type="text" name="title" maxLength={200} required /></label>
        <label>Impact <select name="impact" defaultValue="minor">{IMPACTS.map((i) => <option key={i}>{i}</option>)}</select></label>
        <div className="inline">Affects: {snap.services.map((s) => (
          <label key={s.id} className="inline"><input type="checkbox" name="services" value={s.id} /> {s.name}</label>
        ))}</div>
        <label>First update <textarea name="body" rows={2} maxLength={5000} required /></label>
        <button>Create incident</button>
      </form>

      <h2>Open incidents</h2>
      {snap.open.length === 0 && <p className="muted">None.</p>}
      {snap.open.map((i) => (
        <form key={i.id} action={addUpdateAction} className="card" data-testid="admin-incident">
          <h3>{i.title} <span className="muted">· {i.impact} · {i.status}</span></h3>
          <input type="hidden" name="incidentId" value={i.id} />
          <div className="inline">
            <select name="status" defaultValue={i.status}>{INCIDENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <input type="text" name="body" placeholder="Update message" required />
            <button>Post update</button>
          </div>
        </form>
      ))}

      <h2>Services</h2>
      <div className="card">
        <table><tbody>
          {snap.services.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td><span className={`pill ${s.status}`}>{s.status}</span>{s.overridden && <span className="muted"> (manual)</span>}</td>
              <td>
                <form action={setOverrideAction} className="inline">
                  <input type="hidden" name="serviceId" value={s.id} />
                  <select name="override" defaultValue="" aria-label={`Override for ${s.name}`}>
                    <option value="">follow checks</option>
                    {SERVICE_STATUSES.filter((x) => x !== "unknown").map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <button>Set</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </main>
  );
}
