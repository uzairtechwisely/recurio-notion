// app/api/worker/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http"; // <-- fixed: one level up
import {
  notionClient, redisGet, ensureManagedContainers, getWorkspaceIdFromToken
} from "../_utils";
import { RRule } from "rrule";
import { cookies as getCookies } from "next/headers";

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

export async function GET() {
  const sid = (await getCookies()).get("sid")?.value || null;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return noStoreJson({ processed:0, created:0, details:[], error:"no token" }, 401);

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
  const details: Array<{ from: string; to?: string; title?: string; next?: string; movedRule?: boolean; note?: string }> = [];

  for (const r of rules.results) {
    const props = r.properties as any;

    // read config + pointer
    const taskId: string | undefined = props["Task Page ID"]?.rich_text?.[0]?.plain_text;
    const cfg = {
      rule: props["Rule"]?.select?.name || "Weekly",
      byday: (props["By Day"]?.multi_select || []).map((x: any) => x.name as string),
      interval: props["Interval"]?.number || 1,
      time: (props["Time"]?.rich_text?.[0]?.plain_text || ""),
      tz: (props["Timezone"]?.rich_text?.[0]?.plain_text || ""),
      custom: (props["Custom RRULE"]?.rich_text?.[0]?.plain_text || "")
    };
    if (!taskId) { processed++; continue; }

    const page:any = await notion.pages.retrieve({ page_id: taskId }).catch(()=>null);
    if (!page) { processed++; details.push({ from: taskId, note: "missing page" }); continue; }

    const parentDb = page.parent?.database_id;
    const { titleProp, dateProp, doneProp, statusProp } = detectProps(page);
    const due = dateProp ? page.properties?.[dateProp]?.date?.start : null;
    const done = isDone(page, doneProp, statusProp);

    if (!parentDb || !due || !done) { processed++; continue; }

    // ---- build a rule ANCHORED at the task's current Due ----
    const dueStr = String(due);
    const anchor = new Date(dueStr);
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueStr);

    let opts: any = { freq: RRule.DAILY, interval: Number(cfg.interval || 1), dtstart: anchor };
    switch (cfg.rule) {
      case "Weekly":
        opts.freq = RRule.WEEKLY;
        if (Array.isArray(cfg.byday) && cfg.byday.length) {
          opts.byweekday = cfg.byday.map((d: string) => (RRule as any)[d]);
        }
        break;
      case "Monthly": opts.freq = RRule.MONTHLY; break;
      case "Yearly":  opts.freq = RRule.YEARLY;  break;
      case "Daily":
      default:        opts.freq = RRule.DAILY;
    }

    const rr = new RRule(opts);
    const next = rr.after(anchor, false); // strictly after current due
    if (!next) { processed++; continue; }

    const nextValue = isDateOnly ? next.toISOString().slice(0, 10) : next.toISOString();

    // ---- prevent duplicates for that exact next value ----
    const dup:any = await notion.databases.query({
      database_id: parentDb,
      filter: { property: dateProp!, date: { equals: nextValue } },
      page_size: 1
    });
    if (dup.results?.length) { processed++; details.push({ from: taskId, note: "duplicate next exists" }); continue; }

    const title = page.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled";

    // ---- create next task with same schema ----
    const newProps:any = { [titleProp]: { title: [{ text: { content: title } }] } };
    if (dateProp) newProps[dateProp] = { date: { start: nextValue } };
    if (doneProp) newProps[doneProp] = { checkbox: false };

    const newTask:any = await notion.pages.create({
      parent: { database_id: parentDb },
      properties: newProps
    });

    // ---- move rule pointer and VERIFY ----
    let moved = false;
    try {
      await notion.pages.update({
        page_id: r.id,
        properties: { "Task Page ID": { rich_text: [{ text: { content: newTask.id } }] } }
      });
      const recheck:any = await notion.pages.retrieve({ page_id: r.id });
      const nowId: string | undefined = recheck.properties?.["Task Page ID"]?.rich_text?.[0]?.plain_text;
      moved = nowId === newTask.id;

      if (!moved) {
        await notion.pages.create({
          parent: { database_id: rulesDbId },
          properties: {
            "Rule Name": { title: [{ text: { content: `Rule for ${newTask.id.slice(0,6)}` } }] },
            "Task Page ID": { rich_text: [{ text: { content: newTask.id } }] },
            "Rule": { select: { name: cfg.rule } },
            "By Day": { multi_select: (cfg.byday || []).map((n: string) => ({ name: n })) },
            "Interval": { number: Number(cfg.interval || 1) },
            "Time": { rich_text: [{ text: { content: cfg.time || "" } }] },
            "Timezone": { rich_text: [{ text: { content: cfg.tz || "" } }] },
            "Custom RRULE": { rich_text: [{ text: { content: cfg.custom || "" } }] },
            "Active": { checkbox: true }
          }
        });
        await notion.pages.update({ page_id: r.id, properties: { "Active": { checkbox: false } } });
        moved = true;
      }
    } catch {
      try {
        await notion.pages.create({
          parent: { database_id: rulesDbId },
          properties: {
            "Rule Name": { title: [{ text: { content: `Rule for ${newTask.id.slice(0,6)}` } }] },
            "Task Page ID": { rich_text: [{ text: { content: newTask.id } }] },
            "Rule": { select: { name: cfg.rule } },
            "By Day": { multi_select: (cfg.byday || []).map((n: string) => ({ name: n })) },
            "Interval": { number: Number(cfg.interval || 1) },
            "Time": { rich_text: [{ text: { content: cfg.time || "" } }] },
            "Timezone": { rich_text: [{ text: { content: cfg.tz || "" } }] },
            "Custom RRULE": { rich_text: [{ text: { content: cfg.custom || "" } }] },
            "Active": { checkbox: true }
          }
        });
        await notion.pages.update({ page_id: r.id, properties: { "Active": { checkbox: false } } });
        moved = true;
      } catch { /* ignore */ }
    }

    created++; processed++;
    details.push({ from: taskId, to: newTask.id, title, next: nextValue, movedRule: moved });
  }

  return noStoreJson({ processed, created, details });
}
