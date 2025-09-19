// app/api/tasks/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";
import { extractTitle, extractDueISO, isTaskDone } from "../_props";

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
    // permission probe
    try { await notion.databases.retrieve({ database_id: dbId }); }
    catch (e: any) { return noStoreJson({ tasks: [], error: "db_not_shared", detail: e?.message || "" }, 403); }

    // query (fallback without sorts if needed)
    let q: any;
    try {
      q = await notion.databases.query({
        database_id: dbId,
        page_size: 50,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
    } catch {
      q = await notion.databases.query({ database_id: dbId, page_size: 50 });
    }

    const pages: any[] = q?.results || [];
    const now = Date.now();

    const out = pages.map(pg => {
      const props = (pg as any)?.properties || {};
      const name = extractTitle(props);
      const due = extractDueISO(props);
      const done = isTaskDone(props);

      let overdue = false;
      if (due && !done) {
        const d = new Date(due);
        if (+d < now && withinLastDays(due, 14)) overdue = true;
      }

      return { id: pg.id, name, due: due || null, done, parentDb: dbId, hasRule: false, overdue };
    })
    // keep recent + overdue only (as you requested earlier)
    .filter(t => {
      if (t.overdue) return true;
      if (!t.due) return true;
      const d = new Date(t.due);
      return +d >= now - 6 * 3600_000; // last 6h or future
    });

    return noStoreJson({ tasks: out });
  } catch (e: any) {
    return noStoreJson({ tasks: [], error: "unhandled", detail: e?.message || "unknown" }, 500);
  }
}
