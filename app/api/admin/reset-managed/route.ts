// app/api/admin/reset-managed/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { notionClient } from "../../_utils";
import { adoptTokenForThisSession } from "../../_session";

/* --- helpers --- */
async function searchOne(notion: any, query: string, object: "page" | "database") {
  const r = await notion.search({
    query,
    filter: { value: object, property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" }
  } as any);
  return (r?.results || [])[0] || null;
}

async function unarchiveChain(notion: any, pageId: string) {
  let cur: any = pageId;
  for (let i = 0; i < 6; i++) {
    try {
      await notion.pages.update({ page_id: cur, archived: false });
      return true;
    } catch (e: any) {
      // get parent and try to unarchive it first
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
  const need: Record<string, any> = {
    "Task Page ID": { rich_text: {} },
    "Rule": { select: { options: [
      { name: "Daily" }, { name: "Weekly" }, { name: "Monthly" }, { name: "Yearly" }, { name: "Custom" }
    ]}},
    "By Day": { multi_select: { options: [
      { name: "SU" }, { name: "MO" }, { name: "TU" }, { name: "WE" }, { name: "TH" }, { name: "FR" }, { name: "SA" }
    ]}},
    "Interval": { number: {} },
    "Time": { rich_text: {} },
    "Timezone": { rich_text: {} },
    "Custom RRULE": { rich_text: {} },
    "Active": { checkbox: {} },
  };

  const meta: any = await notion.databases.retrieve({ database_id: dbId });
  const have: Record<string, any> = meta?.properties || {};
  const patch: { properties: Record<string, any> } = { properties: {} };

  for (const [k, def] of Object.entries(need) as Array<[string, any]>) {
    const hp: any = have[k];
    if (!hp) {
      patch.properties[k] = def; continue;
    }
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
  const mode = String(body.mode || "").trim(); // "archive" optional

  try {
    // 1) Find or create "Recurio (Managed)" page
    let page: any = await searchOne(notion, "Recurio (Managed)", "page");
    if (page?.archived) {
      await unarchiveChain(notion, page.id);
      page = await notion.pages.retrieve({ page_id: page.id });
    }
    if (!page) {
      page = await notion.pages.create({
        parent: { type: "workspace", workspace: true } as any,
        icon: { type: "emoji", emoji: "🔁" },
        properties: { "Name": { title: [{ text: { content: "Recurio (Managed)" } }] } },
        children: [{
          object: "block",
          type: "embed",
          embed: { url: process.env.APP_URL || "https://recurio-notion.vercel.app" }
        }]
      } as any);
    }

    // 2) Find or create "Recurrence Rules (Managed)" database
    let rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
    if (!rulesDb) {
      rulesDb = await notion.databases.create({
        parent: { type: "page_id", page_id: page.id },
        title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
        properties: {
          "Name": { title: {} },
          "Task Page ID": { rich_text: {} },
          "Rule": { select: { options: [{ name:"Daily" },{ name:"Weekly" },{ name:"Monthly" },{ name:"Yearly" },{ name:"Custom" }] } },
          "By Day": { multi_select: { options: [{name:"SU"},{name:"MO"},{name:"TU"},{name:"WE"},{name:"TH"},{name:"FR"},{name:"SA"}] } },
          "Interval": { number: {} },
          "Time": { rich_text: {} },
          "Timezone": { rich_text: {} },
          "Custom RRULE": { rich_text: {} },
          "Active": { checkbox: {} }
        }
      } as any);
    } else {
      await ensureRulesSchema(notion, rulesDb.id);
    }

    // Optional maintenance
    if (mode === "archive") {
      const rr: any = await notion.databases.query({ database_id: rulesDb.id, page_size: 100 });
      for (const r of rr?.results || []) {
        await notion.pages.update({ page_id: (r as any).id, archived: true });
      }
      return noStoreJson({ ok: true, archived: (rr?.results || []).length, pageId: page.id, dbId: rulesDb.id });
    }

    return noStoreJson({ ok: true, pageId: page.id, dbId: rulesDb.id });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: "reset_failed", detail: e?.message || String(e) }, 500);
  }
}
