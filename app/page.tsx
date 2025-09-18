"use client";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { useEffect, useState } from "react";

/* ---------------- UI helpers ---------------- */

function Btn({
  children,
  onClick,
  title,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      title={title}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={onClick}
      style={{
        border: "1px solid #111",
        background: pressed ? "#f0f0f0" : "#fff",
        padding: "6px 10px",
        cursor: "pointer",
        boxShadow: pressed ? "inset 0 1px 2px rgba(0,0,0,0.25)" : "none",
        transition: "background 0.12s ease",
        borderRadius: 6,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  title,
  bg,
}: {
  children: React.ReactNode;
  title: string;
  bg: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: 12,
        border: "1px solid #111",
        padding: "2px 6px",
        background: bg,
        borderRadius: 4,
      }}
    >
      {children}
    </span>
  );
}

function Help({
  tip,
  wide,
}: {
  tip: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
      <span
        role="button"
        title={typeof tip === "string" ? tip : undefined}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          border: "1px solid #111",
          borderRadius: "50%",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          background: "#fff",
          userSelect: "none",
        }}
      >
        ?
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 5,
            top: 22,
            right: 0,
            maxWidth: wide ? 380 : 260,
            background: "#fff",
            border: "1px solid #111",
            padding: 10,
            borderRadius: 6,
            boxShadow: "2px 2px 0 #111",
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          {tip}
        </div>
      )}
    </span>
  );
}

function fmtDue(d?: string | null) {
  if (!d) return "-";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(d).toLocaleString();
}

/* ---------------- Types ---------------- */

type Db = { id: string; title: string };
type Task = {
  id: string;
  name: string;
  due: string | null;
  done: boolean;
  parentDb: string;
  hasRule?: boolean;
  overdue?: boolean;
};

/* ---------------- Page ---------------- */

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const [dbs, setDbs] = useState<Db[]>([]);
  const [dbId, setDbId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState("");

  const [notice, setNotice] = useState<string | null>(null); // general info/success
  const [saveErr, setSaveErr] = useState<string | null>(null); // under "Make recurring"
  const [syncErr, setSyncErr] = useState<string | null>(null); // under "Sync now"
  const [connectErr, setConnectErr] = useState<string | null>(null); // under "Connect"

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<null | {
    processed: number;
    created: number;
    details?: any[];
  }>(null);

  /* ----- lifecycle ----- */
  async function checkStatus() {
    setChecking(true);
    setConnectErr(null);
    setNotice(null);
    try {
      const d = await (await fetch("/api/me", { cache: "no-store" })).json();
      setConnected(!!d.connected);
      if (d.connected) await loadDbs();
    } catch {
      setConnectErr("Could not check status. Try reloading.");
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    checkStatus();
  }, []);

  function connect() {
    setConnectErr(null);
    setNotice(null);
    window.open("/api/oauth/start", "notionAuth", "width=480,height=720");
    const t = setInterval(async () => {
      try {
        const d = await (await fetch("/api/me", { cache: "no-store" })).json();
        if (d.connected) {
          clearInterval(t);
          setConnected(true);
          await loadDbs();
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);
  }

  async function disconnect() {
    setConnectErr(null);
    const r = await fetch("/api/admin/disconnect", { method: "POST" });
    if (r.ok) {
      setConnected(false);
      setDbs([]);
      setDbId("");
      setTasks([]);
      setTaskId("");
      setNotice("Disconnected. Click ‘Connect Notion’ to link a workspace.");
    } else {
      setConnectErr("Failed to disconnect. Try again.");
    }
  }

  async function clearRules() {
    setNotice(null);
    const ok = confirm("Archive all rule rows in the managed Rules DB? (Reversible)");
    if (!ok) return;
    const r = await fetch("/api/admin/reset-managed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "archive" }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) setNotice(`Archived ${j.archived} rule row(s).`);
    else setNotice(j.error || "Failed to archive rules.");
  }

  async function resetManaged() {
    setNotice(null);
    const ok = confirm(
      "Create a brand-new managed page & Rules DB (old DB will be renamed and kept)?"
    );
    if (!ok) return;
    const r = await fetch("/api/admin/reset-managed", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) setNotice("Fresh managed assets created.");
    else setNotice(j.error || "Failed to recreate managed assets.");
  }

  async function loadDbs() {
    setNotice(null);
    try {
      const r = await fetch("/api/databases", { cache: "no-store" });
      const d = await r.json();
      setDbs(d.databases || []);
    } catch {
      setNotice("Could not load databases. Ensure the integration is added to your DB.");
    }
  }

  async function openDb(id: string) {
    setDbId(id);
    setNotice(null);
    setTaskId("");
    try {
      const r = await fetch(`/api/tasks?db=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      setTasks(d.tasks || []);
    } catch {
      setNotice("Could not load tasks for that database.");
    }
  }

  /* ----- actions ----- */

  async function saveRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveErr(null);
    setNotice(null);
    setSyncResult(null);

    if (!connected) {
      setSaveErr("Connect Notion first.");
      return;
    }
    if (!dbId) {
      setSaveErr("Open a database first.");
      return;
    }
    if (!taskId) {
      setSaveErr("Select a task first.");
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      const body = Object.fromEntries(fd.entries());
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let j: any = {};
      try {
        j = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!res.ok || j.ok === false) {
        setSaveErr(j.error || text || "Failed to save rule.");
      } else {
        setNotice(
          "✅ Rule saved to ‘Recurrence Rules (Managed)’. Mark the task Done in Notion, then click Sync now."
        );
      }
    } catch (err: any) {
      setSaveErr(err?.message || "Network error while saving rule.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setSyncErr(null);
    setNotice(null);
    setSyncResult(null);

    if (!connected) {
      setSyncErr("Connect Notion first.");
      return;
    }

    setSyncing(true);
    try {
      const res = await fetch("/api/worker", { cache: "no-store" });
      const text = await res.text();
      let j: any = {};
      try {
        j = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        setSyncErr(j?.error || text || "Sync failed.");
      } else {
        setSyncResult(j);
        if (j?.created > 0) {
          setNotice(
            `✅ Synced. Created ${j.created} next task(s). The rule now points to the new task.`
          );
          if (dbId) openDb(dbId);
        } else {
          setNotice(
            "Synced. Nothing to create (is a task marked Done and has a Due date?)."
          );
        }
      }
    } catch (err: any) {
      setSyncErr(err?.message || "Network error while syncing.");
    } finally {
      setSyncing(false);
    }
  }

  /* ----- render ----- */

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "32px auto",
        padding: "0 16px",
        fontFamily: "system-ui, Arial, sans-serif",
      }}
    >
      <h1>Recurio — barebones</h1>

      {/* Connect row */}
      <div
        style={{
          border: "1px solid #111",
          padding: 12,
          margin: "12px 0",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Btn
            onClick={connect}
            title="Start the Notion OAuth flow in a popup."
          >
            Connect Notion
          </Btn>
          <Help
            tip={
              <>
                Opens Notion’s consent window. After approving, come back here—
                status turns green and your databases will load.
              </>
            }
          />
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            border: "1px solid #111",
            background: connected ? "#eaffea" : "#fff3f3",
            borderRadius: 6,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: connected ? "#2ecc71" : "#e74c3c",
              display: "inline-block",
            }}
          />
          {checking ? "Checking..." : connected ? "Connected" : "Not connected"}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Btn onClick={checkStatus} title="Re-check connection & refresh DBs.">
            Check status
          </Btn>
          <Help tip="If you connected in another tab or popup, use this to refresh." />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            <Btn onClick={disconnect} title="Clear the current session token.">
              Disconnect
            </Btn>
            <Help tip="Clears this session’s token and cookie. Useful if you linked the wrong workspace." />
          </div>
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            <Btn onClick={clearRules} title="Archive all rows in the managed Rules DB.">
              Clear rules
            </Btn>
            <Help tip="Archives all rule rows (reversible in Notion). Use if you want to start fresh without touching your tasks." />
          </div>
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            <Btn onClick={resetManaged} title="Recreate the hidden page and Rules DB.">
              Reset managed
            </Btn>
            <Help tip="Renames your current ‘Recurrence Rules (Managed)’ DB as OLD and creates a brand-new empty one." />
          </div>
        </div>

        {connectErr && (
          <div style={{ width: "100%", color: "#c0392b", marginTop: 6 }}>
            {connectErr}
          </div>
        )}
      </div>

      {/* Global notice */}
      {notice && (
        <div
          style={{
            border: "1px solid #111",
            padding: 12,
            margin: "12px 0",
            background: "#f9f9f9",
            borderRadius: 6,
          }}
        >
          {notice}
        </div>
      )}

      {/* Sync result details */}
      {syncResult && (
        <div style={{ border: "1px solid #111", padding: 12, margin: "12px 0", borderRadius: 6 }}>
          <b>Sync result:</b> processed {syncResult.processed}, created {syncResult.created}
          {Array.isArray(syncResult.details) && syncResult.details.length > 0 && (
            <ul style={{ marginTop: 6 }}>
              {syncResult.details.map((it, i) => (
                <li key={i}>
                  <small>
                    Created next for <code>{it.title}</code> → due{" "}
                    {fmtDue(it.next)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* DB browser */}
      <div style={{ border: "1px solid #111", padding: 12, margin: "12px 0", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Btn onClick={loadDbs} title="Reload your accessible Notion databases.">
            Refresh Databases
          </Btn>
          <Help tip="If you just shared a DB with the integration, click this to fetch it." />
        </div>
        <ul style={{ marginTop: 8 }}>
          {dbs.map((db) => (
            <li key={db.id} style={{ marginBottom: 8 }}>
              <b>{db.title}</b>{" "}
              <Btn onClick={() => openDb(db.id)} title="Open and show recent/upcoming tasks from this DB.">
                Open
              </Btn>
            </li>
          ))}
        </ul>
      </div>

      {/* Tasks + rule form */}
      {dbId && (
        <div style={{ border: "1px solid #111", padding: 12, margin: "12px 0", borderRadius: 6 }}>
          <h2>Tasks</h2>
          <small>
            Showing upcoming, overdue (last 14 days, not done), and recently created tasks only.
          </small>

          {tasks.length === 0 ? (
            <p><small>No recent or upcoming tasks to show.</small></p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
              {tasks.map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: t.id === taskId ? "#f7f7f7" : "transparent",
                  }}
                >
                  <label style={{ flex: 1, cursor: "pointer" }}>
                    <input type="radio" name="pick" onChange={() => setTaskId(t.id)} />{" "}
                    <b>{t.name}</b> &nbsp; <small>Due: {fmtDue(t.due)}</small>
                  </label>
                  {t.overdue && (
                    <Badge title="Due date has passed (last 14 days)" bg="#ffefef">
                      Overdue
                    </Badge>
                  )}
                  {t.hasRule && (
                    <Badge title="This task is controlled by a recurrence rule" bg="#eefbea">
                      Has rule
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={saveRule} style={{ marginTop: 12 }}>
            <input type="hidden" name="taskPageId" value={taskId} />
            <input type="hidden" name="dbId" value={dbId} />

            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              }}
            >
              <label>
                Rule
                <div style={{ display: "flex", alignItems: "center" }}>
                  <select name="rule" defaultValue="Weekly" style={{ width: "100%" }}>
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Monthly</option>
                    <option>Yearly</option>
                    <option>Custom</option>
                  </select>
                  <Help
                    tip="Pick how often the next task should be created. Weekly repeats on the same weekday/time as the current Due date (unless you specify By Day)."
                  />
                </div>
              </label>

              <label>
                By Day (e.g., MO,WE,FR)
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input name="byday" placeholder="optional" />
                  <Help tip="Use 2-letter weekday codes: MO,TU,WE,TH,FR,SA,SU. For ‘weekdays except Wed’, use MO,TU,TH,FR." />
                </div>
              </label>

              <label>
                Interval
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input type="number" name="interval" defaultValue="1" />
                  <Help tip="Every how many units? (e.g., Weekly + Interval 2 = every 2 weeks)" />
                </div>
              </label>

              <label>
                Time (HH:mm)
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input name="time" placeholder="17:00" />
                  <Help tip="Optional. If your Due has a time, we carry it forward automatically. You can set a time here when saving the rule for Daily/Weekly patterns." />
                </div>
              </label>

              <label>
                Timezone
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input name="tz" placeholder="Europe/London" />
                  <Help tip="Optional. Informational for now; your Due’s stored format (date-only vs datetime) is preserved." />
                </div>
              </label>

              <label style={{ gridColumn: "1 / -1" }}>
                Custom RRULE
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    name="custom"
                    placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,TU,TH,FR"
                    style={{ flex: 1 }}
                  />
                  <Help
                    wide
                    tip={
                      <>
                        <b>When to use:</b> choose <i>Rule = Custom</i> then paste a full iCalendar RRULE.<br />
                        <b>Examples:</b>
                        <ul style={{ margin: "6px 0 0 16px" }}>
                          <li>Weekdays (skip Wed): <code>FREQ=WEEKLY;BYDAY=MO,TU,TH,FR</code></li>
                          <li>Every 3 days: <code>FREQ=DAILY;INTERVAL=3</code></li>
                          <li>1st business day each month (approx): <code>FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO,TU,WE,TH,FR</code></li>
                        </ul>
                      </>
                    }
                  />
                </div>
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", alignItems: "center" }}>
                  <Btn
                    onClick={() => {}}
                    title="Save the recurrence rule for the selected task."
                    /* submit by the form, this Btn just visually lives here */
                  >
                    Make recurring
                  </Btn>
                  <Help tip="Saves/updates the rule. Pick a task first. Then mark it Done in Notion and press Sync now." />
                </div>

                <div style={{ display: "inline-flex", alignItems: "center" }}>
                  <Btn onClick={runNow} title="Run the worker now to create next occurrences.">
                    Sync now
                  </Btn>
                  <Help tip="Creates the next tasks for any rules whose current task is Done and has a Due date." />
                </div>
              </div>

              {/* Inline errors under the action row */}
              {(saving || saveErr) && (
                <div style={{ marginTop: 6 }}>
                  {saving ? (
                    <span style={{ color: "#333" }}>Saving rule…</span>
                  ) : (
                    saveErr && <span style={{ color: "#c0392b" }}>{saveErr}</span>
                  )}
                </div>
              )}
              {(syncing || syncErr) && (
                <div style={{ marginTop: 4 }}>
                  {syncing ? (
                    <span style={{ color: "#333" }}>Syncing…</span>
                  ) : (
                    syncErr && <span style={{ color: "#c0392b" }}>{syncErr}</span>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
