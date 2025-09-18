export const dynamic = "force-dynamic";
export const revalidate = 0;
"use client";
import { useEffect, useState } from "react";

type Db = { id: string; title: string };
type Task = { id: string; name: string; due: string | null; done: boolean; parentDb: string };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string>("");

  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(d => setConnected(!!d.connected));
  }, []);

  async function connect() {
    window.open("/api/oauth/start", "notionAuth", "width=480,height=720");
    const t = setInterval(async () => {
      const d = await (await fetch("/api/me")).json();
      if (d.connected) { clearInterval(t); await loadDbs(); }
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
  }

  async function saveRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    alert(j.ok ? "Recurring set." : j.error || "Failed");
  }

  async function runNow() {
    const r = await fetch("/api/worker");
    const d = await r.json();
    alert(`Processed ${d.processed}, created ${d.created}`);
  }

  return (
    <main className="container">
      <h1>Recurio — barebones v3</h1>

      {!connected ? (
        <div className="card">
          <p>Connect your Notion workspace to continue.</p>
          <button onClick={connect}>Connect Notion</button>
        </div>
      ) : (
        <>
          <div className="card">
            <button onClick={loadDbs}>Refresh Databases</button>
            {dbs.length === 0 && (
              <p style={{marginTop:8}}>
                No databases visible. In Notion, open your Tasks DB → <b>…</b> → <b>Add connections</b> → select your app, then click Refresh.
              </p>
            )}
            <ul>
              {dbs.map((db) => (
                <li key={db.id} style={{marginBottom:8}}>
                  <b>{db.title}</b> &nbsp;
                  <button onClick={() => openDb(db.id)}>Open</button>
                </li>
              ))}
            </ul>
          </div>

          {dbId && (
            <div className="card">
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
                    <button type="button" onClick={runNow}>Run now</button>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
