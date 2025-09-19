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

const MS_DAY = 86_400_000;
const withinDays = (iso: string, days: number) => {
  const d = new Date(iso);
  return !Number.isNaN(+d) && Math.abs(Date.now() - d.getTime()) <= days * MS_DAY;
};
const createdWithinDays = (iso: string, days: number) => {
  const d = new Date(iso);
  return !Number.isNaN(+d) && (Date.now() - d.getTime()) <= days * MS_DAY;
};

export async function GET(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ tasks: [], error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ tasks: [], error: "missing_db_param" }, 400);

  try {
    // Verify access to the DB
    try {
      await notion.databases.retrieve({ database_id: dbId });
    } catch (e: any) {
      return noStoreJson({ tasks: [], error: "db_not_shared", detail: e?.message || "" }, 403);
    }

    // Pull recent pages (most recently edited first)
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
    const pages: any[] = q?.results || [];

    // Build set of page IDs that have recurrence rules
    const rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
    const ruled = new Set<string>();
    if (rulesDb?.id) {
      const rq = await notion.databases.query({ database_id: rulesDb.id, page_size: 100 });
      for (const r of rq.results || []) {
        const p: any = (r as any).properties || {};
        const tid =
          p["Task Page ID"]?.rich_text?.[0]?.plain_text ||
          p["Task Page ID"]?.rich_text?.[0]?.text?.content ||
          "";
        if (tid) ruled.add(String(tid).trim());
      }
    }

    const now = Date.now();
    const shaped = pages.map((pg) => {
      const props = (pg as any)?.properties || {};
      const name = extractTitle(props);
      const due = extractDueISO(props);
      const done = isTaskDone(props);
      const created = (pg as any)?.created_time || (pg as any)?.last_edited_time;
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
        created,
      };
    });

    // Keep the dashboard light:
    // - hide "done"
    // - include overdue (within last 14 days)
    // - include no-due
    // - include due within next 7 days
    // - include worker-created rule tasks created in last 14 days (even if far-dated)
    const tasks = shaped.filter((t) => {
      if (t.done) return false;
      if (t.overdue) return true;
      if (!t.due) return true;
      if (withinDays(t.due, 7)) return true;
      if (t.hasRule && createdWithinDays(t.created, 14)) return true;
      return false;
    });

    return noStoreJson({ tasks });
  } catch (e: any) {
    return noStoreJson(
      { tasks: [], error: "unhandled", detail: e?.message || "unknown" },
      500
    );
  }
}      return { id: pg.id, name, due: due || null, done, parentDb: dbId, hasRule: ruled.has(pg.id), overdue, created };
    });

    // Show only pending tasks, but include:
    // - overdue (within last 14 days),
    // - no due,
    // - due within next 7 days,
    // - OR (newly worker-created rule tasks) created in last 14 days
    const tasks = shaped.filter(t => {
      if (t.done) return false;
      if (t.overdue) return true;
      if (!t.due) return true;
      if (withinDays(t.due, 7)) return true;
      if (t.hasRule && createdWithinDays(t.created, 14)) return true;
      return false;
    });

    return noStoreJson({ tasks });
  } catch (e: any) {
    return noStoreJson({ tasks: [], error: "unhandled", detail: e?.message || "unknown" }, 500);
  }
}
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
