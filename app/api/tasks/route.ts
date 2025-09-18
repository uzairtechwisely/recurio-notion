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
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "checkbox") return !!p?.checkbox;
  }
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
  return v?.end || v?.start || null;
}
function withinLastDays(dateISO: string, days: number): boolean {
  const d = new Date(dateISO);
  if (Number.isNaN(+d)) return false;
  return Date.now() - d.getTime() <= days * 86400000;
}

export async function GET(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ tasks: [], error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ tasks: [], error: "missing_db_param" }, 400);

  try {
    // 1) Permission sanity check: can the bot see this DB?
    try {
      await notion.databases.retrieve({ database_id: dbId });
    } catch (e: any) {
      const msg = e?.message || "";
      // Notion returns 404 if the bot has no access to that DB
      return noStoreJson({ tasks: [], error: "db_not_shared", detail: msg }, 403);
    }

    // 2) Query pages in the DB (try with sorts, then fallback without)
    let q: any;
    try {
      q = await notion.databases.query({
        database_id: dbId,
        page_size: 50,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
    } catch (e1: any) {
      // Fallback: some DBs reject timestamp sorts due to schema/version quirks
      try {
        q = await notion.databases.query({ database_id: dbId, page_size: 50 });
      } catch (e2: any) {
        return noStoreJson({ tasks: [], error: "query_failed", detail: e2?.message || e1?.message }, 500);
      }
    }

    const pages: any[] = q?.results || [];

    // 3) Identify tasks that have active rules (best-effort, failure is non-fatal)
    let ruleTaskIds = new Set<string>();
    try {
      const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
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
    } catch {
      // ignore; we can still show tasks without rules
    }

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

      return { id: pg.id, name: title, due: due || null, done, parentDb: dbId, hasRule, overdue };
    }).filter(t => {
      if (t.overdue) return true;
      if (!t.due) return true;
      const d = new Date(t.due);
      return +d >= Date.now() - 6 * 3600_000; // last 6h or future
    });

    return noStoreJson({ tasks: out });
  } catch (e: any) {
    return noStoreJson({ tasks: [], error: "unhandled", detail: e?.message || "unknown" }, 500);
  }
}
