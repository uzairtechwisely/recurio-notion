// app/api/rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

/* helpers */
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
    query, filter: { value: object, property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" }
  } as any);
  return (r?.results || [])[0] || null;
}
async function unarchiveChain(notion: any, pageId: string) {
  let cur: any = pageId;
  for (let i = 0; i < 6; i++) {
    try { await notion.pages.update({ page_id: cur, archived: false }); return true; }
    catch {
      const pg: any = await notion.pages.retrieve({ page_id: cur }).catch(() => null);
      const parent = pg?.parent;
      const parentPage = parent?.type === "page_id" ? parent.page_id : null;
      if (!parentPage) return false;
      cur = parentPage;
    }
  }
  return false;
}
async function ensureRulesSchema(notion: any, dbId: string) {
  const meta: any = await notion.databases.retrieve({ database_id: dbId });
  const have: Record<string, any> = meta?.properties || {};
  const need: Record<string, any> = {
    "Task Page ID": { rich_text: {} },
    "Rule": { select: { options: [{name:"Daily"},{name:"Weekly"},{name:"Monthly"},{name:"Yearly"},{name:"Custom"}] } },
    "By Day": { multi_select: { options: [{name:"SU"},{name:"MO"},{name:"TU"},{name:"WE"},{name:"TH"},{name:"FR"},{name:"SA"}] } },
    "Interval": { number: {} },
    "Time": { rich_text: {} },
    "Timezone": { rich_text: {} },
    "Custom RRULE": { rich_text: {} },
    "Active": { checkbox: {} },
  };
  const patch: { properties: Record<string, any> } = { properties: {} };
  for (const [k, def] of Object.entries(need) as Array<[string, any]>) {
    const hp: any = have[k];
    if (!hp) { patch.properties[k] = def; continue; }
    if (def?.select) {
      const haveOpts = (hp.select?.options || []).map((o: any) => String(o.name));
      const needOpts = (def.select.options || []).map((o: any) => String(o.name));
      const add = needOpts.filter((n: string) => !haveOpts.includes(n));
      if (add.length) patch.properties[k] = { select: { options: [ ...(hp.select?.options || []), ...add.map((n: string)=>({name:n})) ] } };
    }
    if (def?.multi_select) {
      const haveOpts = (hp.multi_select?.options || []).map((o: any) => String(o.name));
      const needOpts = (def.multi_select.options || []).map((o: any) => String(o.name));
      const add = needOpts.filter((n: string) => !haveOpts.includes(n));
      if (add.length) patch.properties[k] = { multi_select: { options: [ ...(hp.multi_select?.options || []), ...add.map((n: string)=>({name:n})) ] } };
    }
  }
  if (Object.keys(patch.properties).length) {
    await notion.databases.update({ database_id: dbId, properties: patch.properties });
  }
}

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

  let attempt = 0;
  while (attempt < 2) {
    try {
      attempt++;

      // (a) find containers
      let managedPage: any = await searchOne(notion, "Recurio (Managed)", "page");
      if (managedPage?.archived) await unarchiveChain(notion, managedPage.id);
      let rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
      if (!rulesDb) {
        // If missing, rebuild via reset-managed logic
        const page = managedPage && managedPage.id
          ? managedPage
          : await notion.pages.create({
              parent: { type: "workspace", workspace: true } as any,
              icon: { type: "emoji", emoji: "🔁" },
              properties: { "Name": { title: [{ text: { content: "Recurio (Managed)" } }] } },
              children: [{ object:"block", type:"embed", embed:{ url: process.env.APP_URL || "https://recurio-notion.vercel.app" } }]
            } as any);
        rulesDb = await notion.databases.create({
          parent: { type: "page_id", page_id: page.id },
          title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
          properties: {
            "Name": { title: {} }, "Task Page ID": { rich_text: {} },
            "Rule": { select: { options: [{name:"Daily"},{name:"Weekly"},{name:"Monthly"},{name:"Yearly"},{name:"Custom"}] } },
            "By Day": { multi_select: { options: [{name:"SU"},{name:"MO"},{name:"TU"},{name:"WE"},{name:"TH"},{name:"FR"},{name:"SA"}] } },
            "Interval": { number: {} }, "Time": { rich_text: {} }, "Timezone": { rich_text: {} },
            "Custom RRULE": { rich_text: {} }, "Active": { checkbox: {} }
          }
        } as any);
      } else {
        await ensureRulesSchema(notion, rulesDb.id);
      }

      // (b) task checks
      const task: any = await notion.pages.retrieve({ page_id: taskPageId });
      if (task?.archived) return noStoreJson({ ok:false, error:"task_archived", hint:"Unarchive the task in Notion." }, 400);
      const title = titleOf(task);

      // (c) detect title key
      const meta: any = await notion.databases.retrieve({ database_id: rulesDb.id });
      const titleKey = Object.keys(meta?.properties || {}).find(k => meta.properties[k]?.type === "title") || "Name";

      // (d) upsert rule
      const props: any = {
        [titleKey]: { title: [{ text: { content: title } }] },
        "Task Page ID": { rich_text: [{ type: "text", text: { content: taskPageId } }] },
        "Rule": { select: { name: custom ? "Custom" : rule } },
        "By Day": { multi_select: byday.map(n => ({ name: n })) },
        "Interval": { number: Number.isFinite(interval) ? interval : 1 },
        "Active": { checkbox: true },
      };
      if (time) props["Time"] = { rich_text: [{ type: "text", text: { content: time } }] };
      if (tz) props["Timezone"] = { rich_text: [{ type: "text", text: { content: tz } }] };
      if (custom) props["Custom RRULE"] = { rich_text: [{ type: "text", text: { content: custom } }] };

      const existing: any = await notion.databases.query({
        database_id: rulesDb.id,
        filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
        page_size: 1
      });

      if (existing.results?.length) {
        const pageId = existing.results[0].id;
        try { await unarchiveChain(notion, pageId); } catch {}
        await notion.pages.update({ page_id: pageId, properties: props });
        return noStoreJson({ ok: true, updated: true, pageId });
      } else {
        const created: any = await notion.pages.create({
          parent: { database_id: rulesDb.id }, properties: props
        });
        return noStoreJson({ ok: true, created: true, pageId: created.id });
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      // If we hit archived/parent-archived first time, try one repair cycle then retry
      if (attempt < 2 && /archiv/i.test(msg)) {
        try {
          const managed = await searchOne(notion, "Recurio (Managed)", "page");
          if (managed?.id) await unarchiveChain(notion, managed.id);
        } catch {}
        continue; // retry once
      }
      return noStoreJson({ ok: false, error: "save_rule_failed", detail: msg }, 500);
    }
  }

  return noStoreJson({ ok: false, error: "save_rule_failed", detail: "unknown" }, 500);
}
