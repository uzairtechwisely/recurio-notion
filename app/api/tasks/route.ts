export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../_http";
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
  if (!dbId) return noStoreJson({ tasks: [], meta: {} });

  const sid = (await getCookies()).get("sid")?.value;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return noStoreJson({ tasks: [], meta: {} }, 401);

  const notion = notionClient(tok.access_token);

  // Detect schema
  const schema: any = await notion.databases.retrieve({ database_id: dbId });
  const props = schema.properties || {};
  const titleProp  = Object.keys(props).find(k => props[k].type === "title") || "Name";
  const dueProp    = Object.keys(props).find(k => props[k].type === "date")  || null;
  const doneProp   = Object.keys(props).find(k => props[k].type === "checkbox") || null;
  const statusProp = Object.keys(props).find(k => props[k].type === "status") || null;

  // Build filter: upcoming OR overdue (last 14d) OR (no due & created last 14d)
  const todayStr  = new Date().toISOString().slice(0,10);
  const past14Str = new Date(Date.now() - 14*24*60*60*1000).toISOString().slice(0,10);
  const recentIso = new Date(Date.now() - 14*24*60*60*1000).toISOString();

  let filter: any;
  if (dueProp) {
    filter = {
      or: [
        { property: dueProp, date: { on_or_after: todayStr } },
        { and: [
          { property: dueProp, date: { on_or_after: past14Str } },
          { property: dueProp, date: { before: todayStr } }
        ]},
        { and: [
          { property: dueProp, date: { is_empty: true } },
          { timestamp: "created_time", created_time: { on_or_after: recentIso } }
        ]}
      ]
    };
  } else {
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
    if (!t.due) return true;
    const d = t.due.slice(0,10);
    if (d >= todayStr) return true;   // upcoming
    if (d < past14Str) return false;  // too old
    return !t.done;                    // overdue window & NOT done
  });

  return noStoreJson({ tasks, meta: { titleProp, dueProp, doneProp, statusProp } });
}
