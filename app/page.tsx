"use client";

import React, { useEffect, useRef, useState } from "react";

/* --------- tiny helpers --------- */
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function OutlineBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }
) {
  const { pressed, className, ...rest } = props;
  return (
    <button
      {...rest}
      className={clsx("recurio-btn", pressed ? "recurio-pressed" : "", className)}
      style={{
        border: "1px solid #111",
        background: pressed ? "#f4f4f4" : "#fff",
        padding: "8px 12px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 14,
        ...(props.style || {}),
      }}
    />
  );
}

function Banner({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "10px 12px",
        border: "1px solid #111",
        borderRadius: 6,
        background: "#ffffe6",
        fontSize: 13,
      }}
    >
      {msg}
    </div>
  );
}

/* --------- accessible tooltip that works in Notion iframe --------- */
function Help({ title }: { title: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-block", overflow: "visible" }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Help"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 20,
          height: 20,
          lineHeight: "20px",
          textAlign: "center",
          border: "1px solid #111",
          borderRadius: 999,
          background: "#fff",
          cursor: "help",
          fontSize: 12,
          padding: 0,
          marginLeft: 6,
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Help"
          style={{
            position: "absolute",
            zIndex: 9999,
            top: 0,
            left: "calc(100% + 8px)",
            background: "#fff",
            border: "1px solid #111",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            padding: "10px 12px",
            borderRadius: 6,
            fontSize: 12,
            color: "#111",
            maxWidth: 280,
            pointerEvents: "auto",
            overflow: "visible",
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {title}
        </div>
      )}
    </div>
  );
}

/* --------- types --------- */
type Db = { id: string; title: string };
type Task = {
  id: string;
  name: string;
  due: string | null;
  hasRule: boolean;
  overdue: boolean;
  done?: boolean;
  parentDb?: string;
  created?: string;
};

/* --------- fetch helper --------- */
async function j<T = any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input.toString(), {
    credentials: "include",
    cache: "no-store",
    ...(init || {}),
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {} as T;
  return (await res.json()) as T;
}

/* ===========================
   Main Page
   =========================== */
export default function Page() {
  // connection
  const [connected, setConnected] = useState(false);
  const [via, setVia] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  // db + tasks
  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);

  // rule form
  const [rule, setRule] = useState<"Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom">(
    "Weekly"
  );
  const [interval, setInterval] = useState<number>(1);
  const [byday, setByday] = useState<string>("MO,TU,WE,TH,FR");
  const [time, setTime] = useState<string>("");
  const [tz, setTz] = useState<string>("Europe/London");
  const [custom, setCustom] = useState<string>("");

  // inline button errors
  const [inlineError, setInlineError] = useState<Record<string, string | null>>({});

  const fmt = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(+d)) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  /* ----- OAuth handoff (iframe-safe) ----- */
  useEffect(() => {
    // URL fallback (?handoff=...)
    const url = new URL(window.location.href);
    const h = url.searchParams.get("handoff");
    (async () => {
      if (h) {
        try {
          await fetch(`/api/session/adopt?h=${encodeURIComponent(h)}`, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
          });
        } catch {}
        url.searchParams.delete("handoff");
        window.history.replaceState({}, "", url.toString());
        await refreshConnection();
        await refreshDatabases();
      }
    })();

    // postMessage from /api/oauth/done broadcaster
    async function onMsg(e: MessageEvent) {
      if (e?.data?.type === "recurio:oauth-complete") {
        const hh = e?.data?.handoff;
        if (hh) {
          try {
            await fetch(`/api/session/adopt?h=${encodeURIComponent(hh)}`, {
              method: "POST",
              credentials: "include",
              cache: "no-store",
            });
          } catch {}
        }
        setStatus("Connected. Loading…");
        await refreshConnection();
        await refreshDatabases();
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- loaders ----- */
  async function refreshConnection() {
    try {
      const me = await j<any>("/api/me");
      setConnected(!!me?.connected);
      setVia(me?.via || null);
      if (!me?.connected) setStatus("Not connected. Click ‘Connect Notion’."); else setStatus("");
      return !!me?.connected;
    } catch {
      setConnected(false);
      setVia(null);
      setStatus("Unable to determine connection. Try Connect Notion.");
      return false;
    }
  }

  async function refreshDatabases() {
    setStatus("Loading databases…");
    try {
      const res = await j<{ databases: Db[] }>("/api/databases");
      setDbs(res.databases || []);
      setStatus(
        res.databases?.length
          ? "Databases loaded."
          : "No databases yet. Share your Tasks DB with Recurio and refresh."
      );
    } catch {
      setStatus("Failed to load databases.");
    }
  }

  async function openDb(id: string) {
    setDbId(id);
    setTaskId(null);
    setStatus("Loading tasks…");
    try {
      const res = await j<{ tasks: Task[] }>(`/api/tasks?db=${encodeURIComponent(id)}`);
      setTasks(res.tasks || []);
      setStatus(res.tasks?.length ? "Tasks loaded." : "No tasks to show for this DB.");
    } catch {
      setStatus("Could not load tasks for that database.");
    }
  }

  /* ----- actions ----- */
  function openConnectPopup() {
  // IMPORTANT: no "noopener" or "noreferrer" so window.opener is available for postMessage
  window.open("/api/oauth/start", "recurio-oauth", "width=600,height=750");
}

  async function onDisconnect() {
    setInlineError((p) => ({ ...p, disconnect: null }));
    try {
      await j("/api/admin/disconnect", { method: "POST" });
      setConnected(false);
      setVia(null);
      setDbs([]);
      setDbId(null);
      setTasks([]);
      setTaskId(null);
      setStatus("Disconnected. You can connect a different Notion account now.");
    } catch {
      setInlineError((p) => ({ ...p, disconnect: "Could not clear session. Try refresh." }));
    }
  }

  async function onResetManaged(mode?: "archive") {
    setInlineError((p) => ({ ...p, reset: null }));
    setStatus(mode === "archive" ? "Archiving all rules…" : "Ensuring managed assets…");
    try {
      const res = await fetch(`/api/admin/reset-managed${mode ? `?mode=${mode}` : ""}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("Managed assets are ready.");
      if (dbId) await openDb(dbId);
    } catch {
      setInlineError((p) => ({
        ...p,
        reset: "Failed. Is the integration shared ‘Can edit’ to your workspace?",
      }));
      setStatus("Failed to prepare managed assets.");
    }
  }

  async function onSyncNow() {
    if (!connected) {
      setInlineError((p) => ({ ...p, sync: "Connect Notion first." }));
      return;
    }
    if (!dbId) {
      setInlineError((p) => ({ ...p, sync: "Pick a Tasks database first." }));
      return;
    }
    setInlineError((p) => ({ ...p, sync: null }));
    setStatus("Syncing…");
    try {
      const res = await j<any>("/api/worker", {
        method: "POST",
        body: JSON.stringify({ dbId }),
      });
      const { processed, created } = res || {};
      setStatus(`Sync finished. Processed ${processed ?? 0}; Created ${created ?? 0}.`);
      await openDb(dbId);
    } catch {
      setStatus("Sync failed.");
      setInlineError((p) => ({ ...p, sync: "Sync failed. Check DB sharing and try again." }));
    }
  }

  async function onMakeRecurring() {
    if (!taskId) {
      setInlineError((p) => ({ ...p, recur: "Select a task first." }));
      return;
    }
    setInlineError((p) => ({ ...p, recur: null }));
    setStatus("Saving rule…");
    try {
      const body = { taskId, rule, byday, interval, time, tz, custom };
      const res = await fetch("/api/rules", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || js?.ok === false) throw new Error(js?.error || "save_rule_failed");
      setStatus("Rule saved. Mark this task Done in Notion, then click Sync now.");
      if (dbId) await openDb(dbId);
    } catch {
      setInlineError((p) => ({
        ...p,
        recur: "Save failed. Ensure the DB is shared ‘Can edit’ and try again.",
      }));
      setStatus("Save rule failed.");
    }
  }

  // initial ping
  useEffect(() => {
    refreshConnection().then((ok) => {
      if (ok) refreshDatabases();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- render ----- */
  return (
    <main
      style={{
        maxWidth: 980,
        margin: "32px auto",
        padding: "0 16px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0 }}>Recurio Dashboard</h1>
        <div style={{ fontSize: 13, color: connected ? "#0a0" : "#900" }}>
          {connected ? (
            <>
              Connected <span title={`via: ${via || "-"}`}>✓</span>
            </>
          ) : (
            "Not connected"
          )}
        </div>
      </header>

      <Banner msg={status} />

      <p style={{ color: "#555", fontSize: 13, marginTop: 4 }}>
        Only <b>pending</b> and <b>recent/overdue</b> tasks are shown here for a lightweight
        view.
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "visible" }}>
          <OutlineBtn onClick={() => openConnectPopup()}>Connect Notion</OutlineBtn>
          <Help title="Opens Notion OAuth in a popup/tab. Approve access; this dashboard will auto-refresh (works inside Notion iframe too)." />
        </div>
        <div
          style={{
            textAlign: "right",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            overflow: "visible",
          }}
        >
          <OutlineBtn onClick={onDisconnect}>Disconnect</OutlineBtn>
          <Help title="Clears this tab’s session only. Use to switch accounts." />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "visible" }}>
          <OutlineBtn onClick={() => onResetManaged()}>Reset managed</OutlineBtn>
          <Help title='Creates/repairs “Recurio (Managed)” page and “Recurrence Rules (Managed)” DB.' />
        </div>
        <div
          style={{
            textAlign: "right",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            overflow: "visible",
          }}
        >
          <OutlineBtn onClick={() => onResetManaged("archive")}>Archive all rules</OutlineBtn>
          <Help title="Archives all rule rows (soft off). You can re-enable on specific tasks later." />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "visible" }}>
          <OutlineBtn onClick={refreshDatabases}>Refresh databases</OutlineBtn>
          <Help title="Loads databases the Recurio integration can see. Share your Tasks DB with Recurio (Can edit)." />
        </div>
        <div
          style={{
            textAlign: "right",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            overflow: "visible",
          }}
        >
          <OutlineBtn onClick={onSyncNow} disabled={!connected}>
            Sync now
          </OutlineBtn>
          <Help title="For each ‘done’ task with a rule, creates the next one and carries the rule forward." />
        </div>

        {/* inline error rows */}
        <div style={{ minHeight: 18, color: "#b00020", fontSize: 12 }}>{inlineError.reset}</div>
        <div style={{ minHeight: 18, color: "#b00020", fontSize: 12, textAlign: "right" }}>
          {inlineError.sync}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <div style={{ border: "1px solid #111", padding: 12, borderRadius: 6 }}>
          <h3 style={{ margin: 0 }}>Databases</h3>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {dbs.map((d) => (
              <li
                key={d.id}
                style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}
              >
                <OutlineBtn
                  pressed={dbId === d.id}
                  onClick={() => openDb(d.id)}
                  style={{ padding: "6px 10px" }}
                >
                  Open
                </OutlineBtn>
                <span style={{ fontSize: 13, wordBreak: "break-word" }}>
                  <b>{d.title || "Untitled"}</b>
                  <br />
                  <small style={{ color: "#555" }}>{d.id}</small>
                </span>
              </li>
            ))}
            {!dbs.length && (
              <li style={{ color: "#666", fontSize: 13 }}>
                No databases yet. Share your Tasks DB with <b>Recurio</b> (Can edit), then
                “Refresh databases”.
              </li>
            )}
          </ul>
        </div>

        <div style={{ border: "1px solid #111", padding: 12, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Tasks</h3>
            {dbId && <small style={{ color: "#555" }}>DB: {dbId}</small>}
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: "8px 0 16px",
              padding: 0,
              maxHeight: 360,
              overflow: "auto",
            }}
          >
            {tasks.map((t) => (
              <li
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: "1px dashed #eee",
                }}
              >
                <label style={{ flex: 1, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="pick"
                    checked={taskId === t.id}
                    onChange={() => setTaskId(t.id)}
                  />{" "}
                  <b>{t.name}</b> &nbsp; <small>Due: {fmt(t.due)}</small>
                </label>
                {t.overdue && (
                  <span
                    title="Due date has passed (last 14 days)"
                    style={{
                      fontSize: 12,
                      border: "1px solid #111",
                      padding: "2px 6px",
                      background: "#ffefef",
                    }}
                  >
                    Overdue
                  </span>
                )}
                {t.hasRule && (
                  <span
                    title="This task is controlled by a recurrence rule"
                    style={{
                      fontSize: 12,
                      border: "1px solid #111",
                      padding: "2px 6px",
                      background: "#eefbea",
                    }}
                  >
                    Has rule
                  </span>
                )}
              </li>
            ))}
            {!tasks.length && (
              <li style={{ color: "#666", fontSize: 13 }}>
                No tasks to show. Pick a DB on the left.
              </li>
            )}
          </ul>

          {/* rule form */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Rule <Help title='Choose frequency. “Custom” lets you enter a full RFC5545 RRULE string.' />
              </div>
              <select
                value={rule}
                onChange={(e) => setRule(e.target.value as any)}
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              >
                <option>Daily</option>
                <option>Weekly</option>
                <option>Monthly</option>
                <option>Yearly</option>
                <option>Custom</option>
              </select>
            </label>

            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Interval <Help title="Repeat every N units (e.g., Weekly + Interval 2 = every 2 weeks)." />
              </div>
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Number(e.target.value || 1)))}
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                By day{" "}
                <Help title='For Weekly. Comma list: MO,TU,WE,TH,FR,SA,SU. Tip: Daily but skip weekends? Use Custom: FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' />
              </div>
              <input
                type="text"
                value={byday}
                onChange={(e) => setByday(e.target.value)}
                placeholder="MO,TU,WE…"
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Time <Help title="Optional 24h time. Example: 09:00" />
              </div>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Timezone <Help title='IANA TZ (e.g., Europe/London). Stored for future TZ-aware scheduling.' />
              </div>
              <input
                type="text"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="Europe/London"
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              />
            </label>

            <label style={{ gridColumn: "1 / span 2" }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Custom RRULE{" "}
                <Help title='Full RRULE overrides fields above. Examples: FREQ=DAILY;INTERVAL=1 · FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR · FREQ=MONTHLY;BYMONTHDAY=1' />
              </div>
              <input
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"
                style={{ width: "100%", padding: 8, border: "1px solid #111", borderRadius: 4 }}
              />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", overflow: "visible" }}>
            <OutlineBtn onClick={onMakeRecurring}>Make recurring</OutlineBtn>
            <Help title="Saves/updates rule for the selected task. Then mark the task Done in Notion and click Sync now." />
            <OutlineBtn onClick={() => dbId && openDb(dbId)} style={{ marginLeft: "auto" }}>
              Reload tasks
            </OutlineBtn>
          </div>
          <div style={{ minHeight: 18, color: "#b00020", fontSize: 12 }}>
            {inlineError.recur}
          </div>
        </div>
      </section>
    </main>
  );
}
