import { NextResponse } from "next/server";
import { notionClient, redisGet, buildRRule, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

function detectProps(page: any) {
  let titleProp = "Name", dateProp: string | null = null, doneProp: string | null = null, statusProp: string | null = null;
  for (const k of Object.keys(page.properties || {})) {
    const t = page.properties[k]?.type;
    if (t === "title") titleProp = k;
    if (t === "date" && !dateProp) dateProp = k;
    if (t === "checkbox" && !doneProp) doneProp = k;
    if (t === "status" && !statusProp) statusProp = k;
  }
  return { titleProp, dateProp, doneProp, statusProp };
}

function isDone(page: any, doneProp: string | null, statusProp: string | null) {
  if (doneProp) return !!page.properties?.[doneProp]?.checkbox;
  if (statusProp) {
    const name = page.properties?.[statusProp]?.status?.name?.toLowerCase?.() || "";
    return ["done","completed","complete","finished","closed"].includes(name);
  }
  return false;
}

export async function GET(req: Request) {
  const tok = await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ processed:0, created:0, details:[] });

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);

  // pull active rules
  const rules:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 100
  });

  let processed = 0, created = 0;
  const details:any[] = [];

  for (const r of rules.results) {
    const p = r.properties as any;
    const taskId = p["Task Page ID"]?.rich_text?.[0]?.plain_text;
    if (!taskId) { processed++; continue; }

    // read rule config
    const cfg = {
      rule: p["Rule"]?.select?.name || "Weekly",
      byday: (p["By Day"]?.multi_select || []).map((x:any)=>x.name),
      interval: p["Interval"]?.number || 1,
      time: (p["Time"]?.rich_text?.[0]?.plain_text || ""),
      tz: (p["Timezone"]?.rich_text?.[0]?.plain_text || ""),
      custom: (p["Custom RRULE"]?.rich_text?.[0]?.plain_text || "")
    };

    // fetch current task
    const page:any = await notion.pages.retrieve({ page_id: taskId }).catch(()=>null);
    if (!page) { processed++; continue; }

    const parentDb = page.parent?.database_id;
    const { titleProp, dateProp, doneProp, statusProp } = detectProps(page);
    const due = dateProp ? page.properties?.[dateProp]?.date?.start : null;
    const done = isDone(page, doneProp, statusProp);

    if (!parentDb || !due || !done) { processed++; continue; }

    // compute next date
    const rule = buildRRule(cfg);
    const next = rule.after(new Date(due), true);
    if (!next) { processed++; continue; }

    // avoid duplicate
    const dup:any = await notion.databases.query({
      database_id: parentDb,
      filter: { property: dateProp!, date: { equals: next.toISOString() } },
      page_size: 1
    });
    if (dup.results?.length) { processed++; continue; }

    const title = page.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled";

    // create next task with same prop names
    const props:any = {
      [titleProp]: { title: [{ text: { content: title } }] }
    };
    if (dateProp) props[dateProp] = { date: { start: next.toISOString() } };
    if (doneProp) props[doneProp] = { checkbox: false };

    const newTask:any = await notion.pages.create({
      parent: { database_id: parentDb },
      properties: props
    });

    // move rule forward by updating Task Page ID
    await notion.pages.update({
      page_id: r.id,
      properties: {
        "Task Page ID": { rich_text: [{ type: "text", text: { content: newTask.id } }] }
      }
    });

    created++; processed++;
    details.push({ from: taskId, to: newTask.id, title, next: next.toISOString() });
  }

  return NextResponse.json({ processed, created, details });
}
