// app/api/tasks/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

function pickTitle(props: any): string {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "title") {
      const arr = p?.title || [];
      return arr.map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}
function pickFirstOfType(props: any, type: string) {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === type) return { key: k, prop: p };
  }
  return { key: null, prop: null };
}
function isDone(props: any): boolean {
  // Prefer a checkbox
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "checkbox") return !!p?.checkbox;
  }
  // Fallback: Status with name "Done"
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "status") {
      const name = p?.status?.name || "";
      if (String(name).toLowerCase() === "done") return true;
    }
  }
  return false;
}
function getDueISO(props: any): string | null {
  const { key, prop } = pickFirstOfType(props, "date");
  if (!key || !prop) return null;
  const v = prop?.date;
  if (!v) return null;
  // Prefer end or start; preserve date-only vs datetime
  return v?.end || v?.start || null;
}
function withinLastDays(dateISO: string, days: number): boolean {
  const d = new Date(dateISO);
  if (Number.isNaN(+d)) return false;
  const now = Date.now();
  return now - d.getTime() <= days * 86400000;
}

export async function GET(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ tasks: [], error: "no token" }, 401);
  const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ tasks: [], error: "missing db param" }, 400);

  try {
    // Query tasks (recent & upcoming)
    const q: any = await notion.databases.query({
      database_id: dbId,
      page_size: 50,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });

    const pages: any[] = q?.results || [];

    // Build a set of task IDs that have rules, to set hasRule flag
    const workspaceId = getWorkspaceIdFromToken(tok) || tok.workspace_id;
    let ruleTaskIds = new Set<string>();
    try {
      if (workspaceId) {
        const { dbId: rulesDb } = await ensureManagedContainers(notion, workspaceId);
        if (rulesDb) {
          const rr: any = await notion.databases.query({
            database_id: rulesDb,
            filter: { property: "Active", checkbox: { equals: true } },
            page_size: 100,
          });
          for (const r of rr?.results || []) {
            const props = (r as any)?.properties || {};
            const txt = props?.["Task Page ID"]?.rich_text || [];
            const id = (txt[0]?.plain_text || txt[0]?.text?.content || "").trim();
            if (id) ruleTaskIds.add(id);
          }
        }
      }
    } catch { /* ignore rule lookup errors */ }

    const now = new Date();
    const out = pages.map((pg: any) => {
      const props = pg?.properties || {};
      const due = getDueISO(props);
      const done = isDone(props);
      const title = pickTitle(props);
      const hasRule = ruleTaskIds.has(pg.id);

      let overdue = false;
      if (due && !done) {
        const d = new Date(due);
        if (+d < +now && withinLastDays(due, 14)) overdue = true;
      }

      return {
        id: pg.id,
        name: title,
        due: due || null,
        done,
        parentDb: dbId,
        hasRule,
        overdue,
      };
    })
    // Keep list light: overdue (<=14d), upcoming (>= now), or recently edited
    .filter(t => {
      if (t.overdue) return true;
      if (!t.due) return true; // no due: still show (user may add a rule)
      const d = new Date(t.due);
      return +d >= Date.now() - 6 * 3600_000; // due from last 6h or future
    });

    return noStoreJson({ tasks: out });
  } catch (e: any) {
    return noStoreJson({ tasks: [], error: e?.message || "Could not load tasks" }, 500);
  }
}
