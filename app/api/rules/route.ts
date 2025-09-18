// app/api/rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

/* ---------- small helpers ---------- */
function toByDayList(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map(s => s.trim().toUpperCase()).filter(Boolean);
  return String(input).split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}
function titleOf(page: any): string {
  const props = page?.properties || {};
  for (const key of Object.keys(props || {})) {
    const p: any = (props as any)[key];
    if (p?.type === "title") {
      const arr = p?.title || [];
      return arr.map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Task";
    }
  }
  return "Task";
}

/* ---------- ensure/repair rules DB schema, return detected keys ---------- */
async function ensureRulesSchemaAndKeys(notion: any, dbId: string) {
  const meta: any = await notion.databases.retrieve({ database_id: dbId });
  const existing: Record<string, any> = meta?.properties || {};

  // Detect current title property key
  let titleKey = Object.keys(existing).find(k => existing[k]?.type === "title") || "Name";

  // Required (non-title) properties we rely on
  const needed: Record<string, any> = {
    "Task Page ID": { rich_text: {} },
    "Rule":         { select: { options: [
      { name: "Daily" }, { name: "Weekly" }, { name: "Monthly" }, { name: "Yearly" }, { name: "Custom" }
    ]}},
    "By Day":       { multi_select: { options: [
      { name: "SU" }, { name: "MO" }, { name: "TU" }, { name: "WE" }, { name: "TH" }, { name: "FR" }, { name: "SA" }
    ]}},
    "Interval":     { number: {} },
    "Time":         { rich_text: {} },
    "Timezone":     { rich_text: {} },
    "Custom RRULE": { rich_text: {} },
    "Active":       { checkbox: {} },
  };

  const patch: { properties: Record<string, any> } = { properties: {} };

  // Create missing non-title properties and fill missing options
  for (const [name, def] of Object.entries(needed) as Array<[string, any]>) {
    const have: any = existing[name];

    if (!have) {
      patch.properties[name] = def;
      continue;
    }
    // Enrich select options if needed
    if (def?.select) {
      const haveOpts = (have.select?.options || []).map((o: any) => String(o.name));
      const needOpts = (def.select.options || []).map((o: any) => String(o.name));
      const addOpts = needOpts.filter((n: string) => !haveOpts.includes(n));
      if (addOpts.length) {
        patch.properties[name] = {
          select: { options: [ ...(have.select?.options || []), ...addOpts.map((n: string) => ({ name: n })) ] }
        };
      }
    }
    // Enrich multi_select options if needed
    if (def?.multi_select) {
      const haveOpts = (have.multi_select?.options || []).map((o: any) => String(o.name));
      const needOpts = (def.multi_select.options || []).map((o: any) => String(o.name));
      const addOpts = needOpts.filter((n: string) => !haveOpts.includes(n));
      if (addOpts.length) {
        patch.properties[name] = {
          multi_select: { options: [ ...(have.multi_select?.options || []), ...addOpts.map((n: string) => ({ name: n })) ] }
        };
      }
    }
  }

  if (Object.keys(patch.properties).length > 0) {
    await notion.databases.update({ database_id: dbId, properties: patch.properties });
  }

  return { titleKey };
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

  try {
    const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
    if (!workspaceId) return noStoreJson({ ok: false, error: "no_workspace_id" }, 400);

    // Ensure managed containers exist; unarchive the container page defensively
    const { dbId: rulesDb, pageId: managedPageId } = await ensureManagedContainers(notion, workspaceId);
    if (!rulesDb) return noStoreJson({ ok: false, error: "rules_db_missing" }, 500);
    if (managedPageId) { try { await notion.pages.update({ page_id: managedPageId, archived: false }); } catch {} }

    // Ensure schema and discover title key
    const { titleKey } = await ensureRulesSchemaAndKeys(notion, rulesDb);

    // Load task; refuse if archived
    const task: any = await notion.pages.retrieve({ page_id: taskPageId });
    if (task?.archived) {
      return noStoreJson({ ok: false, error: "task_archived", hint: "Unarchive the task in Notion, then try again." }, 400);
    }
    const title = titleOf(task);

    // Build properties with dynamic title key
    const ruleProps: any = {
      [titleKey]:    { title: [{ text: { content: title } }] },
      "Task Page ID": { rich_text: [{ type: "text", text: { content: taskPageId } }] },
      "Rule":         { select: { name: custom ? "Custom" : rule } },
      "By Day":       { multi_select: byday.map((n: string) => ({ name: n })) },
      "Interval":     { number: Number.isFinite(interval) ? interval : 1 },
      "Active":       { checkbox: true },
    };
    if (time)   ruleProps["Time"]         = { rich_text: [{ type: "text", text: { content: time } }] };
    if (tz)     ruleProps["Timezone"]     = { rich_text: [{ type: "text", text: { content: tz } }] };
    if (custom) ruleProps["Custom RRULE"] = { rich_text: [{ type: "text", text: { content: custom } }] };

    // Find existing rule (even if archived)
    const existing: any = await notion.databases.query({
      database_id: rulesDb,
      filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
      page_size: 1,
    });

    if (existing.results?.length) {
      const pageId = existing.results[0].id;
      try { await notion.pages.update({ page_id: pageId, archived: false }); } catch {}
      await notion.pages.update({ page_id: pageId, properties: ruleProps });
      return noStoreJson({ ok: true, updated: true, pageId });
    }

    const created: any = await notion.pages.create({
      parent: { database_id: rulesDb },
      properties: ruleProps,
    });
    return noStoreJson({ ok: true, created: true, pageId: created.id });

  } catch (e: any) {
    // Bubble up exact Notion diagnostics so you can show them in UI
    const detail = e?.message || String(e);
    const status = e?.status || e?.code || null;
    return noStoreJson({ ok: false, error: "save_rule_failed", status, detail }, 500);
  }
}
