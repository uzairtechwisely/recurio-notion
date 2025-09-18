import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet, notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

function isDoneLocal(page: any, doneProp: string | null, statusProp: string | null) {
  if (doneProp) return !!page.properties?.[doneProp]?.checkbox;
  if (statusProp) {
    const name = page.properties?.[statusProp]?.status?.name?.toLowerCase?.() || "";
    return ["done","completed","complete","finished","closed"].includes(name);
  }
  return false;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return NextResponse.json({ tasks: [], meta: {} });

  // per-session token
  const store = await getCookies();
  const sid = store.get("sid")?.value || null;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return NextResponse.json({ tasks: [], meta: {} });

  const notion = notionClient(tok.access_token);

  // Detect schema
  const schema: any = await notion.databases.retrieve({ database_id: dbId });
  const props = schema.properties || {};
  const titleProp  = Object.keys(props).find(k => props[k].type === "title") || "Name";
  const dueProp    = Object.keys(props).find(k => props[k].type === "date")  || null;
  const doneProp   = Object.keys(props).find(k => props[k].type === "checkbox") || null;
  const statusProp = Object.keys(props).find(k => props[k].type === "status") || null;

  // Build filter: upcoming OR overdue (last 14d) OR (no due & created last 14d)
  const todayStr  = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const past14Str = new Date(Date.now() - 14*24*60*60*1000).toISOString().slice(0,10);
  const recentIso = new Date(Date.now() - 14*24*60*60*1000).toISOString();

  let filter: any;
  if (dueProp) {
    filter = {
      or: [
        // Upcoming (today or later)
        { property: dueProp, date: { on_or_after: todayStr } },
        // Overdue within last 14 days (we’ll still filter out "done" server-side)
        { and: [
          { property: dueProp, date: { on_or_after: past14Str } },
          { property: dueProp, date: { before: todayStr } }
        ]},
        // No due-date, but recently created (last 14d)
        { and: [
          { property: dueProp, date: { is_empty: true } },
          { timestamp: "created_time", created_time: { on_or_after: recentIso } }
        ]}
      ]
    };
  } else {
    // No Date property at all → just show recently created
    filter = { timestamp: "created_time", created_time: { on_or_after: recentIso } };
  }

  const query: any = { database_id: dbId, page_size: 50, filter };
  if (dueProp) query.sorts = [{ property: dueProp, direction: "ascending" }];
  const res: any = await notion.databases.query(query);

  // Build set of Task IDs that have an ACTIVE rule
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);
  const rules:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 100
  });
  const ruleSet = new Set<string>(
    rules.results
      .map((r:any) => r.properties?.["Task Page ID"]?.rich_text?.[0]?.plain_text)
      .filter(Boolean)
  );

  // Map rows and compute "overdue" (only if within last 14d AND not done)
  const tasksRaw = res.results.map((p: any) => {
    const name = p.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled";
    const due  = dueProp ? (p.properties?.[dueProp]?.date?.start || null) : null;
    const done = isDoneLocal(p, doneProp, statusProp);
    const dueDay = due ? String(due).slice(0,10) : null;
    const isOverdueWindow = !!(dueDay && dueDay < todayStr && dueDay >= past14Str);
    const overdue = !!(isOverdueWindow && !done);
    return {
      id: p.id,
      name,
      due,
      done,
      parentDb: dbId!,
      hasRule: ruleSet.has(p.id),
      overdue
    };
  });

  // Hide overdue older than 14d or any overdue that is done
  const tasks = tasksRaw.filter((t: any) => {
    if (!t.due) return true; // recently created no-due tasks already filtered by created_time
    const d = t.due.slice(0,10);
    if (d >= todayStr) return true;             // upcoming
    if (d < past14Str) return false;            // too old
    return !t.done;                              // overdue in window & NOT done
  });

  return NextResponse.json({ tasks, meta: { titleProp, dueProp, doneProp, statusProp } });
}
