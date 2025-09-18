"use client";
import { useEffect, useState } from "react";

type Db = { id: string; title: string };
type Task = { id: string; name: string; due: string | null; done: boolean; parentDb: string };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState("");

  async function checkStatus() {
    setChecking(true);
    const d = await (await fetch("/api/me")).json();
    setConnected(!!d.connected);
    setChecking(false);
    if (d.connected) loadDbs(); // auto-load when connected
  }

  useEffect(() => { checkStatus(); }, []);

  async function connect() {
    // Start OAuth; callback overwrites any old token and sets tok:latest
    window.open("/api/oauth/start", "notionAuth", "width=480,height=720");
    const t = setInterval(async () => {
      const d = await (await fetch("/api/me")).json();
      if (d.connected) { clearInterval(t); setConnected(true); await loadDbs(); }
    }, 1500);
  }

  async function loadDbs() {
    const r = await fetch("/api/databases");
    const d = await r.json();
    setDbs(d.databases || []);
  }

  async function openDb(id: string) {
    setDbId(id);
    const r = await fetch(`/api/tasks?db=${encodeURIComponent(id)}`);
    const d = await r.json();
    setTasks(d.tasks || []);
    setTaskId("");
  }

  async function saveRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await res.json();
    alert(j.ok ? "Recurring set." : j.error || "Failed");
  }

  async function runNow() {
    const r = await fetch("/api/worker");
    const d = await r.json();
    alert(`Processed ${d.processed}, created ${d.created}`);
  }

  return (
    <main style={{maxWidth:840, margin:"32px auto", padding:"0 16px", fontFamily:"system-ui, Arial"}}>
      <h1>Recurio — barebones</h1>

      {/* Connect section (always visible) */}
      <div style={{border:"1px solid #111", padding:12, margin:"12px 0", display:"flex", alignItems:"center", gap:12}}>
        <button onClick={connect}>Connect Notion</button>
        <span style={{
          display:"inline-flex", alignItems:"center", gap:8, padding:"4px 8px",
          border:"1px solid #111", background: connected ? "#eaffea" : "#fff3f3"
        }}>
          <span style={{
            width:10, height:10, borderRadius:"50%",
            background: connected ? "#2ecc71" : "#e74c3c", display:"inline-block"
          }} />
          {checking ? "Checking..." : connected ? "Connected" : "Not connected"}
        </span>
        <button onClick={checkStatus} style={{marginLeft:"auto"}}>Check status</button>
      </div>

      {/* DB browser */}
      <div style={{border:"1px solid #111", padding:12, margin:"12px 0"}}>
        <div style={{display:"flex", gap:8, alignItems:"center"}}>
          <button onClick={loadDbs} disabled={!connected}>Refresh Databases</button>
          {!connected && <small>Connect first to list your databases.</small>}
        </div>

        {connected && dbs.length === 0 && (
          <p style={{marginTop:8}}>
            No databases visible. In Notion, open your Tasks DB → <b>…</b> → <b>Add connections</b> → select this app, then click Refresh.
          </p>
        )}

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

          {taskId && (
            <form onSubmit={saveRule} style={{marginTop:12}}>
              <input type="hidden" name="taskPageId" value={taskId} />
              <input type="hidden" name="dbId" value={dbId} />
              <div style={{display:"grid", gap:8, gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))"}}>
                <label>Rule
                  <select name="rule" defaultValue="Weekly">
                    <option>Daily</option><option>Weekly</option>
                    <option>Monthly</option><option>Yearly</option>
                    <option>Custom</option>
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
                <button type="submit">Make recurring</button>
                <button type="button" onClick={runNow}>Sync now</button>
              </div>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
