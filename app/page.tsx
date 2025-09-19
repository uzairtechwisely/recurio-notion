// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* --- UI bits --- */
function Banner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div style={{ margin: "12px 0", padding: "10px 12px", border: "1px solid #ccc", background: "#fffceb", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
      {msg}
    </div>
  );
}
function Help({ title }: { title: string }) {
  return (
    <span title={title} style={{ display: "inline-block", width: 18, height: 18, lineHeight: "18px", textAlign: "center", border: "1px solid #111", borderRadius: 9, fontSize: 12, marginLeft: 6, cursor: "help" }}>?</span>
  );
}
const btnBase: React.CSSProperties = { border: "1px solid #111", padding: "8px 12px", background: "#fff", cursor: "pointer", fontSize: 14, lineHeight: "18px", borderRadius: 4, userSelect: "none" };
function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  const { pressed, style, children, ...rest } = props;
  return (
    <button {...rest} style={{ ...btnBase, ...(pressed ? { background: "#f3f3f3", boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.04)" } : {}), ...(style || {}) }}>
      {children}
    </button>
  );
}

/* --- API --- */
async function callApi<T = any>(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  const bad = !res.ok || (body && body.ok === false);
  const code = body?.error || res.statusText || `HTTP ${res.status}`;
  const detail = body?.detail || body?.status || "";
  const message = bad ? (detail ? `${code} — ${detail}` : code) : "";
  return { ok: !bad, res, body: body as T, message };
}

/* --- types --- */
type Db = { id: string; title: string };
type Task = { id: string; name: string; due: string | null; done: boolean; parentDb: string; hasRule?: boolean; overdue?: boolean };

/* --- helpers --- */
const fmt = (iso: string | null) => {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch { return iso; }
};

export default function RecurioDashboard() {
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [via, setVia] = useState<string | null>(null);

  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);

  const [rule, setRule] = useState<"Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom">("Weekly");
  const [byday, setByday] = useState<string>("MO");
  const [interval, setInterval] = useState<number>(1);
  const [time, setTime] = useState<string>("09:00");
  const [tz, setTz] = useState<string>("Europe/London");
  const [custom, setCustom] = useState<string>("");

  const selectedTask = useMemo(() => tasks.find(t => t.id === taskId) || null, [tasks, taskId]);

  useEffect(() => {
  const h = new URL(window.location.href).searchParams.get("handoff");
  if (h) {
    fetch(`/api/session/adopt?h=${encodeURIComponent(h)}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    }).finally(() => {
      // clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("handoff");
      window.history.replaceState({}, "", url.toString());
      // refresh UI
      refreshConnection().then(() => refreshDatabases());
    });
  }
}, []);
  
  useEffect(() => {
    fetch("/api/session/init", { credentials: "include" }).catch(() => {});
    refreshConnection();
  }, []);
  useEffect(() => {
  async function onMsg(e: MessageEvent) {
    if (e?.data?.type === "recurio:oauth-complete") {
      const h = e?.data?.handoff;
      if (h) {
        // Bind token to this origin’s session
        await fetch(`/api/session/adopt?h=${encodeURIComponent(h)}`, { method: "POST", credentials: "include", cache: "no-store" });
      }
      // then refresh UI
      setStatus("Connected. Loading…");
      await refreshConnection();
      await refreshDatabases();
    }
  }
  window.addEventListener("message", onMsg);
  return () => window.removeEventListener("message", onMsg);
}, []);

  async function refreshConnection() {
    const { ok, body } = await callApi<{ connected: boolean; source?: string }>("/api/me");
    setConnected(!!body?.connected && ok);
    setVia(body?.source || null);
    return ok && body?.connected;
  }

  function onConnect() {
    setStatus("Opening Notion…");
    const popup = window.open("/api/oauth/start", "recurio_oauth", "width=420,height=640");
    let tries = 0;
    let handle: number = window.setInterval(async () => {
      tries++;
      const ok = await refreshConnection();
      if (ok || tries > 20) {
        window.clearInterval(handle);
        if (ok) {
          setStatus("Connected ✅");
          refreshDatabases();
          try { popup?.close(); } catch {}
        } else {
          setStatus("Connection didn’t complete. Try again.");
        }
      }
    }, 800);
  }

  async function onDisconnect() {
    setStatus("Disconnecting…");
    const { ok, message } = await callApi("/api/admin/disconnect", { method: "POST" });
    setConnected(false); setVia(null); setDbId(null); setTasks([]); setTaskId(null);
    setStatus(ok ? "Disconnected ✅" : `Disconnect failed: ${message}`);
  }

  async function refreshDatabases() {
    setStatus("Loading databases…");
    const { ok, body, message } = await callApi<{ databases: Db[] }>("/api/databases");
    if (!ok) { setStatus(`Load DBs failed: ${message}`); return; }
    setDbs(body?.databases || []); setStatus(`Loaded ${body?.databases?.length ?? 0} databases ✅`);
  }

  async function openDb(id: string) {
    setDbId(id); setTaskId(null); setStatus("Loading tasks…");
    const { ok, body, message } = await callApi<{ tasks: Task[] }>(`/api/tasks?db=${encodeURIComponent(id)}`);
    if (!ok) { setTasks([]); setStatus(`Could not load tasks: ${message}`); return; }
    setTasks(body?.tasks || []); setStatus(`Loaded ${body?.tasks?.length ?? 0} tasks ✅`);
  }

  async function onMakeRecurring() {
    if (!taskId) { setStatus("Select a task first (radio) before clicking Make recurring."); return; }
    const payload: any = { taskPageId: taskId, rule, byday, interval, time, tz, custom: rule === "Custom" ? custom : "" };
    setStatus("Saving rule…");
    const { ok, message } = await callApi("/api/rules", { method: "POST", body: JSON.stringify(payload) });
    setStatus(ok ? "Rule saved ✅" : `Save failed: ${message}`);
    if (dbId) openDb(dbId);
  }

  async function onSyncNow() {
    setStatus("Syncing…");
    const { ok, body, message } = await callApi<{ processed: number; created: number }>("/api/worker", { method: "POST", body: JSON.stringify({ dbId }) });
    if (!ok) { setStatus(`Sync failed: ${message}`); return; }
    setStatus(`Sync done ✅  processed: ${body?.processed ?? 0}; created: ${body?.created ?? 0}`);
    if (dbId) openDb(dbId);
  }

  async function onResetManaged(mode?: "archive") {
    setStatus(mode === "archive" ? "Archiving rules…" : "Repairing managed assets…");
    const { ok, body, message } = await callApi<{ ok: boolean; pageId?: string; dbId?: string; archived?: number }>("/api/admin/reset-managed", {
      method: "POST", body: JSON.stringify({ mode }),
    });
    if (!ok || !body?.ok) { setStatus(`Reset failed: ${message}`); return; }
    const info = body?.archived != null ? `Archived ${body.archived} rule(s)` : `Ready (Page ${body.pageId?.slice(0,6)}…, DB ${body.dbId?.slice(0,6)}…)`;
    setStatus(`Managed assets OK ✅  ${info}`);
  }

  return (
    <main style={{ maxWidth: 980, margin: "32px auto", padding: "0 16px", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Recurio Dashboard</h1>
        <div style={{ fontSize: 13, color: connected ? "#0a0" : "#900" }}>
          {connected ? <>Connected <span title={`via: ${via || "-"}`}>✓</span></> : "Not connected"}
        </div>
      </header>

      <Banner msg={status} />

      <p style={{ color:"#555", fontSize:13, marginTop:4 }}>
        Only <b>pending</b> and <b>recent/overdue</b> tasks are shown here for a lightweight view.
      </p>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <button
                onClick={() => {
                  window.open(
                    "/api/oauth/start",
                    "recurio-oauth",
                    "width=600,height=750,noopener,noreferrer"
                  );
                }}
              >
                Connect Notion
         </button>
          <Help title="Opens Notion OAuth in a popup/tab. Approve access; this dashboard will auto-refresh, in-browser or inside Notion iframe." />
        </div>
        <div style={{ textAlign: "right" }}>
          <Btn onClick={onDisconnect}>Disconnect</Btn>
          <Help title="Clears this tab's session only. Use to switch accounts." />
        </div>

        <div>
          <Btn onClick={() => onResetManaged()}>Reset managed</Btn>
          <Help title='Creates/repairs "Recurio (Managed)" page and "Recurrence Rules (Managed)" DB.' />
        </div>
        <div style={{ textAlign: "right" }}>
          <Btn onClick={() => onResetManaged("archive")}>Archive all rules</Btn>
          <Help title="Archives all rule rows (soft off). You can re-enable on specific tasks later." />
        </div>

        <div>
          <Btn onClick={refreshDatabases}>Refresh databases</Btn>
          <Help title="Loads databases the Recurio integration can see. Share your Tasks DB with Recurio (Can edit)." />
        </div>
        <div style={{ textAlign: "right" }}>
          <Btn onClick={onSyncNow} disabled={!connected}>Sync now</Btn>
          <Help title="Marks completed tasks and creates the next ones per rules." />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <div style={{ border: "1px solid #111", padding: 12, borderRadius: 6 }}>
          <h3 style={{ margin: 0 }}>Databases</h3>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {dbs.map((d) => (
              <li key={d.id} style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <Btn pressed={dbId === d.id} onClick={() => openDb(d.id)} style={{ padding: "6px 10px" }}>Open</Btn>
                <span style={{ fontSize: 13, wordBreak: "break-word" }}>
                  <b>{d.title || "Untitled"}</b>
                  <br /><small style={{ color: "#555" }}>{d.id}</small>
                </span>
              </li>
            ))}
            {!dbs.length && <li style={{ color: "#666", fontSize: 13 }}>No databases yet. Share your Tasks DB with <b>Recurio</b> (Can edit), then “Refresh databases”.</li>}
          </ul>
        </div>

        <div style={{ border: "1px solid #111", padding: 12, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Tasks</h3>
            {dbId && <small style={{ color: "#555" }}>DB: {dbId}</small>}
          </div>

          <ul style={{ listStyle: "none", margin: "8px 0 16px", padding: 0, maxHeight: 360, overflow: "auto" }}>
            {tasks.map((t) => (
              <li key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px dashed #eee" }}>
                <label style={{ flex: 1, cursor: "pointer" }}>
                  <input type="radio" name="pick" checked={taskId === t.id} onChange={() => setTaskId(t.id)} />{" "}
                  <b>{t.name}</b> &nbsp; <small>Due: {fmt(t.due)}</small>
                </label>
                {t.overdue && (
                  <span title="Due date has passed (last 14 days)" style={{ fontSize: 12, border: "1px solid #111", padding: "2px 6px", background: "#ffefef" }}>
                    Overdue
                  </span>
                )}
                {t.hasRule && (
                  <span title="This task is controlled by a recurrence rule" style={{ fontSize: 12, border: "1px solid #111", padding: "2px 6px", background: "#eefbea" }}>
                    Has rule
                  </span>
                )}
              </li>
            ))}
            {!tasks.length && <li style={{ color: "#666", fontSize: 13 }}>No tasks to show. Pick a DB on the left.</li>}
          </ul>

          {/* rule form */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Rule <Help title='Choose frequency. "Custom" lets you enter a full RRULE string.' /></div>
              <select value={rule} onChange={(e) => setRule(e.target.value as any)} style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}>
                <option>Daily</option><option>Weekly</option><option>Monthly</option><option>Yearly</option><option>Custom</option>
              </select>
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Interval <Help title="Repeat every N units (e.g., Weekly + Interval 2 = every 2 weeks)." /></div>
              <input type="number" min={1} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value || 1)))} style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }} />
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>By day <Help title='For Weekly. Comma list: MO,TU,WE,TH,FR,SA,SU. Tip: Daily but skip weekends? Use Custom: FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR' /></div>
              <input type="text" value={byday} onChange={(e) => setByday(e.target.value)} placeholder="MO,TU,WE…" style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }} />
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Time <Help title="Optional 24h time. Example: 09:00" /></div>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }} />
            </label>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Timezone <Help title='IANA TZ (e.g., Europe/London). Stored for future TZ-aware scheduling.' /></div>
              <input type="text" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Europe/London" style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }} />
            </label>
            <label style={{ gridColumn: "1 / span 2" }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Custom RRULE <Help title='Full RRULE overrides fields above. Example: FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR' /></div>
              <input type="text" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="FREQ=WEEKLY;INTERVAL=1;BYDAY=MO" style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }} />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Btn onClick={onMakeRecurring}>Make recurring</Btn>
            <Help title="Saves/updates rule for selected task. Then mark the task Done in Notion and click Sync now." />
            <Btn onClick={() => dbId && openDb(dbId)} style={{ marginLeft: "auto" }}>Reload tasks</Btn>
          </div>
        </div>
      </section>
    </main>
  );
}
