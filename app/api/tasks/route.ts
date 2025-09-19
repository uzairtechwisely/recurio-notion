// app/api/tasks/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";
import { extractTitle, extractDueISO, isTaskDone } from "../_props";

async function searchOne(notion: any, query: string, object: "page" | "database") {
  const r = await notion.search({
    query,
    filter: { value: object, property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
  } as any);
  return (r?.results || [])[0] || null;
}

function withinDays(iso: string, days: number): boolean {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return false;
  return Math.abs(Date.now() - d.getTime()) <= days * 86400000;
}

export async function GET(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ tasks: [], error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ tasks: [], error: "missing_db_param" }, 400);

  try {
    // 0) probe DB access early
    try { await notion.databases.retrieve({ database_id: dbId }); }
    catch (e: any) { return noStoreJson({ tasks: [], error: "db_not_shared", detail: e?.message || "" }, 403); }

    // 1) fetch recent pages (descending by last edited)
    let q: any;
    try {
      q = await notion.databases.query({
        database_id: dbId,
        page_size: 100,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
    } catch {
      q = await notion.databases.query({ database_id: dbId, page_size: 100 });
    }

    // 2) build a set of taskPageIds that have rules
    const rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
    let ruled: Set<string> = new Set();
    if (rulesDb?.id) {
      const rq = await notion.databases.query({ database_id: rulesDb.id, page_size: 100 });
      for (const r of rq.results || []) {
        const p: any = (r as any).properties || {};
        const tid =
          p["Task Page ID"]?.rich_text?.[0]?.plain_text ||
          p["Task Page ID"]?.rich_text?.[0]?.text?.content || "";
        if (tid) ruled.add(String(tid).trim());
      }
    }

    const now = Date.now();
    const RECENT_DAYS = 7; // recent window for dashboard
    const pages: any[] = q?.results || [];

    // 3) shape tasks
    const shaped = pages.map(pg => {
      const props = (pg as any)?.properties || {};
      const name = extractTitle(props);
      const due = extractDueISO(props);
      const done = isTaskDone(props);

      let overdue = false;
      if (due && !done) {
        const d = new Date(due);
        if (+d < now && withinDays(due, 14)) overdue = true;
      }

      return {
        id: pg.id,
        name,
        due: due || null,
        done,
        parentDb: dbId,
        hasRule: ruled.has(pg.id),
        overdue,
      };
    });

    // 4) filter for UI needs: only pending (not done), keep overdue, recent, or no-due
    const tasks = shaped.filter(t => {
      if (t.done) return false;
      if (t.overdue) return true;
      if (!t.due) return true;
      return withinDays(t.due, RECENT_DAYS);
    });

    return noStoreJson({ tasks });
  } catch (e: any) {
    return noStoreJson({ tasks: [], error: "unhandled", detail: e?.message || "unknown" }, 500);
  }
}
