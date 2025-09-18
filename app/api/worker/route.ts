import { NextResponse } from "next/server";
import {
  notionClient, redisGet, buildRRule,
  ensureManagedContainers, getWorkspaceIdFromToken
} from "../_utils";

function detectProps(page: any) {
  let titleProp = "Name", dateProp: string | null = null, doneProp: string | null = null, statusProp: string | null = null;
  for (const k of Object.keys(page.properties || {})) {
    const t = page.properties[k]?.type;
    if (t === "title") titleProp = k;
    if (t === "date"  && !dateProp)  dateProp = k;
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
  if (!tok?.access_token) return NextResponse.json({ processed:0, created:0, details:[], error:"no token" });

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);

  // 1) pull active rules
  const rules:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 100
  });

  let processed = 0, created = 0;
  const details: Array<{ from: string; to: string; title: string; next: string; movedRule: boolean }> = [];

  for (const r of rules.results) {
    const props = r.properties as any;

    // read rule config + current task id
    const taskId: string | undefined = props["Task Page ID"]?.rich_text?.[0]?.plain_text;
    const cfg: {
      rule: string;
      byday: string[];
      interval: number;
      time: string;
      tz: string;
      custom: string;
    } = {
      rule: props["Rule"]?.select?.name || "Weekly",
      byday: (props["By Day"]?.multi_select || []).map((x: any) => x.name as string),
      interval: props["Interval"]?.number || 1,
      time: (props["Time"]?.rich_text?.[0]?.plain_text || ""),
      tz: (props["Timezone"]?.rich_text?.[0]?.plain_text || ""),
      custom: (props["Custom RRULE"]?.rich_text?.[0]?.plain_text || "")
    };
    if (!taskId) { processed++; continue; }

    // fetch the current task
    const page:any = await notion.pages.retrieve({ page_id: taskId }).catch(()=>null);
    if (!page) { processed++; continue; }

    const parentDb = page.parent?.database_id;
    const { titleProp, dateProp, doneProp, statusProp } = detectProps(page);
    const due = dateProp ? page.properties?.[dateProp]?.date?.start : null;
    const done = isDone(page, doneProp, statusProp);

    if (!parentDb || !due || !done) { processed++; continue; }

    // compute next due
    const rule = buildRRule(cfg);
    const next = rule.after(new Date(due), true);
    if (!next) { processed++; continue; }

    // avoid duplicates (same Due)
    const dup:any = await notion.databases.query({
      database_id: parentDb,
      filter: { property: dateProp!, date: { equals: next.toISOString() } },
      page_size: 1
    });
    if (dup.results?.length) { processed++; continue; }

    const title = page.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled";

    // create next task with same schema
    const newProps:any = {
      [titleProp]: { title: [{ text: { content: title } }] }
    };
    if (dateProp) newProps[dateProp] = { date: { start: next.toISOString() } };
    if (doneProp) newProps[doneProp] = { checkbox: false };

    const newTask:any = await notion.pages.create({
      parent: { database_id: parentDb },
      properties: newProps
    });

    // try to MOVE rule to the new task (primary path)
    let moved = false;
    try {
      await notion.pages.update({
        page_id: r.id,
        properties: {
          "Task Page ID": { rich_text: [{ type: "text", text: { content: newTask.id } }] }
        }
      });
      moved = true;
    } catch {
      // fallback: create a fresh rule row for the new task so the series never breaks
      try {
        await notion.pages.create({
          parent: { database_id: rulesDbId },
          properties: {
            "Rule Name": { title: [{ text: { content: `Rule for ${newTask.id.slice(0,6)}` } }] },
            "Task Page ID": { rich_text: [{ type: "text", text: { content: newTask.id } }] },
            "Rule": { select: { name: cfg.rule } },
            "By Day": { multi_select: (cfg.byday || []).map((n: string) => ({ name: n })) },
            "Interval": { number: Number(cfg.interval || 1) },
            "Time": { rich_text: [{ type: "text", text: { content: cfg.time || "" } }] },
            "Timezone": { rich_text: [{ type: "text", text: { content: cfg.tz || "" } }] },
            "Custom RRULE": { rich_text: [{ type: "text", text: { content: cfg.custom || "" } }] },
            "Active": { checkbox: true }
          }
        });
        // optionally deactivate the old row so you don't see two (comment out if you want to keep history)
        await notion.pages.update({ page_id: r.id, properties: { "Active": { checkbox: false } } });
        moved = true;
      } catch { /* ignore */ }
    }

    created++; processed++;
    details.push({ from: taskId, to: newTask.id, title, next: next.toISOString(), movedRule: moved });
  }

  return NextResponse.json({ processed, created, details });
}
