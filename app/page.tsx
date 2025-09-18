"use client";
import { useEffect, useState } from "react";

type Db = { id: string; title: string };
type Task = { id: string; name: string; due: string | null; done: boolean; parentDb: string; hasRule?: boolean };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState("");

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<null | { processed:number; created:number; details?: any[] }>(null);

  async function disconnect() {
  setNotice(null);
  const r = await fetch("/api/admin/disconnect", { method: "POST" });
  if (r.ok) {
    setConnected(false);
    setDbs([]); setDbId(""); setTasks([]);
    setNotice("Disconnected. You can connect Notion again.");
  } else {
    setNotice("Failed to disconnect.");
  }
}

async function resetManaged() {
  setNotice(null);
  if (!confirm("This will recreate the hidden 'Techwisely (Managed)' assets. Existing rule rows won’t be deleted. Continue?")) return;
  const r = await fetch("/api/admin/reset-managed", { method: "POST" });
  const j = await r.json().catch(()=>({}));
  if (r.ok && j.ok) {
    setNotice("Managed assets recreated. If you had rules, save one again to repopulate.");
  } else {
    setNotice(j.error || "Failed to reset managed assets.");
  }
}
  async function checkStatus() {
    setChecking(true);
    setNotice(null);
    const d = await (await fetch("/api/me", { cache: "no-store" })).json();
    setConnected(!!d.connected);
    setChecking(false);
    if (d.connected) loadDbs();
  }
  useEffect(() => { checkStatus(); }, []);

  function connect() {
    window.open("/api/oauth/start", "notionAuth", "width=480,height=720");
    const t = setInterval(async () => {
      const d = await (await fetch("/api/me", { cache: "no-store" })).json();
      if (d.connected) { clearInterval(t); setConnected(true); await loadDbs(); }
    }, 1500);
  }

  async function loadDbs() {
    setNotice(null);
    const r = await fetch("/api/databases", { cache: "no-store" });
    const d = await r.json();
    setDbs(d.databases || []);
  }

  async function openDb(id: string) {
    setDbId(id);
    setNotice(null);
    const r = await fetch(`/api/tasks?db=${encodeURIComponent(id)}`, { cache: "no-store" });
    const d = await r.json();
    setTasks(d.tasks || []);
    setTaskId("");
  }

  async function saveRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    setSyncResult(null);

    if (!taskId) { setNotice("Please select a task first."); return; }
    setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const body = Object.fromEntries(fd.entries());
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch { /* non-JSON error */ }
      if (!res.ok || j.ok === false) {
        setNotice(j.error || text || "Failed to save rule.");
      } else {
        setNotice("✅ Rule saved to ‘Recurrence Rules (Managed)’. Mark the task Done in Notion, then click Sync now.");
      }
    } catch (err: any) {
      setNotice(err?.message || "Network error while saving rule.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setNotice(null);
    setSyncResult(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/worker", { cache: "no-store" });
      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch { /* non-JSON */ }
      if (!res.ok) {
        setNotice(j?.error || text || "Sync failed.");
      } else {
        setSyncResult(j);
        if (j?.created > 0) {
          setNotice(`✅ Synced. Created ${j.created} next task(s). The rule now points to the new task.`);
          // refresh the current DB view to show the new row
          if (dbId) openDb(dbId);
        } else {
          setNotice("Synced. Nothing to create (is the task marked Done and has a Due date?).");
        }
      }
    } catch (err: any) {
      setNotice(err?.message || "Network error while syncing.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main style={{maxWidth:840, margin:"32px auto", padding:"0 16px", fontFamily:"system-ui, Arial"}}>
      <h1>Recurio — barebones</h1>

      {/* Connect row */}
    <div style={{border:"1px solid #111", padding:12, margin:"12px 0", display:"flex", alignItems:"center", gap:12}}>
  <button onClick={connect}>Connect Notion</button>
  <span style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"4px 8px",
                  border:"1px solid #111", background: connected ? "#eaffea" : "#fff3f3" }}>
    <span style={{ width:10, height:10, borderRadius:"50%",
                   background: connected ? "#2ecc71" : "#e74c3c", display:"inline-block" }} />
    {checking ? "Checking..." : connected ? "Connected" : "Not connected"}
  </span>
  <button onClick={checkStatus}>Check status</button>
  <div style={{marginLeft:"auto", display:"flex", gap:8}}>
    <button onClick={disconnect}>Disconnect</button>
    <button onClick={resetManaged}>Reset managed</button>
  </div>
</div>

      {/* Notice / errors */}
      {notice && (
        <div style={{border:"1px solid #111", padding:12, margin:"12px 0", background:"#f9f9f9"}}>
          {notice}
        </div>
      )}

      {/* Sync result details */}
      {syncResult && (
        <div style={{border:"1px solid #111", padding:12, margin:"12px 0"}}>
          <b>Sync result:</b> processed {syncResult.processed}, created {syncResult.created}
          {Array.isArray(syncResult.details) && syncResult.details.length > 0 && (
            <ul style={{marginTop:6}}>
              {syncResult.details.map((it, i) => (
                <li key={i}><small>Created next for <code>{it.title}</code> → due {new Date(it.next).toLocaleString()}</small></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* DB browser */}
      <div style={{border:"1px solid #111", padding:12, margin:"12px 0"}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <button onClick={loadDbs} disabled={!connected}>Refresh Databases</button>
          {!connected && <small>Connect first to list your databases.</small>}
        </div>
        <ul style={{marginTop:8}}>
          {dbs.map((db) => (
            <li key={db.id} style={{marginBottom:8}}>
              <b>{db.title}</b> &nbsp;
              <button onClick={() => openDb(db.id)} disabled={!connected}>Open</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Tasks + rule form */}
      {dbId && (
        <div style={{border:"1px solid #111", padding:12, margin:"12px 0"}}>
          <h2>Tasks</h2>
          <ul>
            {tasks.map(t => (
              <li key={t.id}>
                <label>
                  <input type="radio" name="pick" onChange={() => setTaskId(t.id)} />{" "}
                  <b>{t.name}</b> &nbsp; <small>Due: {t.due || "-"}</small>
                </label>
              </li>
            ))}
          </ul>
          <ul>
              {tasks.map(t => (
                <li key={t.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <label style={{ flex:1 }}>
                    <input type="radio" name="pick" onChange={() => setTaskId(t.id)} />{" "}
                    <b>{t.name}</b> &nbsp; <small>Due: {t.due || "-"}</small>
                  </label>
                  {t.hasRule && (
                    <span title="This task is controlled by a recurrence rule"
                          style={{ fontSize:12, border:"1px solid #111", padding:"2px 6px", background:"#eefbea" }}>
                      Has rule
                    </span>
                  )}
                </li>
              ))}
            </ul>

          <form onSubmit={saveRule} style={{marginTop:12}}>
            <input type="hidden" name="taskPageId" value={taskId} />
            <input type="hidden" name="dbId" value={dbId} />
            <div style={{display:"grid", gap:8, gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>
              <label>Rule
                <select name="rule" defaultValue="Weekly">
                  <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Yearly</option><option>Custom</option>
                </select>
              </label>
              <label>By Day (MO,WE,FR)
                <input name="byday" placeholder="optional"/>
              </label>
              <label>Interval
                <input type="number" name="interval" defaultValue="1"/>
              </label>
              <label>Time (HH:mm)
                <input name="time" placeholder="17:00"/>
              </label>
              <label>Timezone
                <input name="tz" placeholder="Europe/London"/>
              </label>
              <label>Custom RRULE
                <input name="custom" placeholder="if Rule = Custom"/>
              </label>
            </div>
            <div style={{marginTop:10, display:"flex", gap:8}}>
              <button type="submit" disabled={saving}>{saving ? "Saving..." : "Make recurring"}</button>
              <button type="button" onClick={runNow} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
