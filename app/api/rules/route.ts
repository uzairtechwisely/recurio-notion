// app/api/rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

/* ------------ helpers ------------ */
function toByDayList(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map(s => s.trim().toUpperCase()).filter(Boolean);
  return String(input).split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}
function titleOf(page: any): string {
  const props = page?.properties || {};
  for (const k of Object.keys(props || {})) {
    const p: any = (props as any)[k];
    if (p?.type === "title") {
      const arr = p?.title || [];
      return arr.map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Task";
    }
  }
  return "Task";
}
async function searchOne(notion: any, query: string, object: "page" | "database") {
  const r = await notion.search({
    query,
    filter: { value: object, property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" }
  } as any);
  return (r?.results || [])[0] || null;
}
async function ensureRulesDb(notion: any) {
  // 1) Find or create the managed page (top-level PAGE uses `title` key)
  let managed: any = await searchOne(notion, "Recurio (Managed)", "page");
  if (!managed) {
    managed = await notion.pages.create({
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🔁" },
      properties: {
        title: { title: [{ text: { content: "Recurio (Managed)" } }] },
      },
      children: [
        { object: "block", type: "embed", embed: { url: process.env.APP_URL || "https://recurio-notion.vercel.app" } }
      ]
    } as any);
  } else if (managed.archived) {
    try { await notion.pages.update({ page_id: managed.id, archived: false }); } catch {}
  }

  // 2) Find or create the rules DB (DB schema can use named props like "Name")
  let rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
  if (!rulesDb) {
    rulesDb = await notion.databases.create({
      parent: { type: "page_id", page_id: managed.id },
      title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
      properties: {
        "Name": { title: {} },
        "Task Page ID": { rich_text: {} },
        "Rule": { select: { options: [
          { name:"Daily" }, { name:"Weekly" }, { name:"Monthly" }, { name:"Yearly" }, { name:"Custom" }
        ] } },
        "By Day": { multi_select: { options: [
          {name:"SU"},{name:"MO"},{name:"TU"},{name:"WE"},{name:"TH"},{name:"FR"},{name:"SA"}
        ] } },
        "Interval": { number: {} },
        "Time": { rich_text: {} },
        "Timezone": { rich_text: {} },
        "Custom RRULE": { rich_text: {} },
        "Active": { checkbox: {} }
      }
    } as any);
  }
  return { managedId: managed.id, rulesDbId: rulesDb.id };
}

/* ------------ route ------------ */
export async function POST(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const body = await req.json().catch(() => ({} as any));
  const taskPageId = (body.taskPageId || "").trim();
  const rule = (body.rule || "").trim() || "Weekly";
  const byday = toByDayList(body.byday);
  const interval = Number(body.interval || 1);
  const time = (body.time || "").trim();
  const tz = (body.tz || "").trim();
  const custom = (body.custom || "").trim();
  if (!taskPageId) return noStoreJson({ ok: false, error: "missing_taskPageId" }, 400);

  try {
    // Ensure containers exist
    const { rulesDbId } = await ensureRulesDb(notion);

    // Detect the *id* of the Rules DB title property (don’t rely on its display name)
    const meta: any = await notion.databases.retrieve({ database_id: rulesDbId });
    const titleEntry = Object.entries(meta?.properties || {}).find(
      ([, v]: [string, any]) => (v as any)?.type === "title"
    ) as [string, any] | undefined;
    const titlePropId: string = titleEntry ? (((titleEntry[1] as any).id) || "title") : "title";

    // Load the task, refuse if archived
    const task: any = await notion.pages.retrieve({ page_id: taskPageId });
    if (task?.archived) {
      return noStoreJson({ ok: false, error: "task_archived", detail: "Unarchive the task in Notion, then try again." }, 400);
    }
    const title = titleOf(task);

    // Prepare rule properties (use property *id* for title)
    const ruleProps: any = {
      [titlePropId]: { title: [{ text: { content: title } }] },
      "Task Page ID": { rich_text: [{ type: "text", text: { content: taskPageId } }] },
      "Rule": { select: { name: custom ? "Custom" : rule } },
      "By Day": { multi_select: byday.map((n: string) => ({ name: n })) },
      "Interval": { number: Number.isFinite(interval) ? interval : 1 },
      "Active": { checkbox: true }
    };
    if (time)   ruleProps["Time"]         = { rich_text: [{ type: "text", text: { content: time } }] };
    if (tz)     ruleProps["Timezone"]     = { rich_text: [{ type: "text", text: { content: tz } }] };
    if (custom) ruleProps["Custom RRULE"] = { rich_text: [{ type: "text", text: { content: custom } }] };

    // Upsert rule (if an archived rule exists, unarchive and update)
    const existing: any = await notion.databases.query({
      database_id: rulesDbId,
      filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
      page_size: 1
    });

    if (existing.results?.length) {
      const pageId = existing.results[0].id;
      try { await notion.pages.update({ page_id: pageId, archived: false }); } catch {}
      await notion.pages.update({ page_id: pageId, properties: ruleProps });
      return noStoreJson({ ok: true, updated: true, pageId });
    } else {
      const created: any = await notion.pages.create({
        parent: { database_id: rulesDbId },
        properties: ruleProps
      });
      return noStoreJson({ ok: true, created: true, pageId: created.id });
    }
  } catch (e: any) {
    const detail = e?.message || String(e);
    const status = e?.status || e?.code || null;
    return noStoreJson({ ok: false, error: "save_rule_failed", status, detail }, 500);
  }
}
