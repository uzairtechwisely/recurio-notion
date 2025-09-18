import { NextResponse } from "next/server";
import { notionClient, redisGet, buildRRule, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

export async function GET(req: Request) {
  const tok = await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ processed:0, created:0, details:[] });

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);

  // 1) get active rules
  const rules:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 100
  });

  let processed = 0, created = 0;
  const details: any[] = [];

  for (const r of rules.results) {
    const p = r.properties as any;
    const taskRel = p["Task Page"]?.relation || [];
    if (!taskRel.length) { processed++; continue; }
    const taskId = taskRel[0].id;

    // Pull rule config
    const cfg = {
      rule: p["Rule"]?.select?.name || "Weekly",
      byday: (p["By Day"]?.multi_select || []).map((x:any)=>x.name),
      interval: p["Interval"]?.number || 1,
      time: (p["Time"]?.rich_text?.[0]?.plain_text || ""),
      tz: (p["Timezone"]?.rich_text?.[0]?.plain_text || ""),
      custom: (p["Custom RRULE"]?.rich_text?.[0]?.plain_text || "")
    };

    // Fetch task page
    const page:any = await notion.pages.retrieve({ page_id: taskId }).catch(()=>null);
    if (!page) { processed++; continue; }

    const parentDb = page.parent?.database_id;
    const done = page.properties?.Done?.checkbox;
    const due = page.properties?.Due?.date?.start;
    if (!parentDb || !done || !due) { processed++; continue; }

    // Compute next date
    const rule = buildRRule(cfg);
    const next = rule.after(new Date(due), true);
    if (!next) { processed++; continue; }

    // avoid duplicate
    const dup:any = await notion.databases.query({
      database_id: parentDb,
      filter: { property: "Due", date: { equals: next.toISOString() } },
      page_size: 1
    });
    if (dup.results?.length) { processed++; continue; }

    // Create next task
    const title = page.properties?.Name?.title?.[0]?.plain_text || "Untitled";
    const newTask:any = await notion.pages.create({
      parent: { database_id: parentDb },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Done: { checkbox: false },
        Due: { date: { start: next.toISOString() } }
      }
    });

    // **Move** the rule to point at the new task (so the series continues)
    await notion.pages.update({
      page_id: r.id,
      properties: { "Task Page": { relation: [{ id: newTask.id }] } }
    });

    created++; processed++;
    details.push({ from: taskId, to: newTask.id, title, next: next.toISOString() });
  }

  return NextResponse.json({ processed, created, details });
}
