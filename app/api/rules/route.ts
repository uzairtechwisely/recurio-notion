// app/api/rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

export async function POST(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const body = await req.json().catch(() => ({} as any));
  const taskPageId = (body.taskPageId || "").trim();
  const rule = (body.rule || "").trim() || "Weekly";
  const byday = String(body.byday || "").split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
  const interval = Number(body.interval || 1);
  const time = (body.time || "").trim();
  const tz = (body.tz || "").trim();
  const custom = (body.custom || "").trim();

  if (!taskPageId) return noStoreJson({ ok: false, error: "missing_taskPageId" }, 400);

  try {
    const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
    if (!workspaceId) return noStoreJson({ ok: false, error: "no_workspace_id" }, 400);

    // Ensure managed containers exist; also unarchive the container page defensively.
    const { dbId: rulesDb, pageId: managedPageId } = await ensureManagedContainers(notion, workspaceId);
    if (!rulesDb) return noStoreJson({ ok: false, error: "rules_db_missing" }, 500);
    if (managedPageId) {
      try { await notion.pages.update({ page_id: managedPageId, archived: false }); } catch {}
    }

    // Load task; refuse if archived (this is exactly the Notion error you saw)
    const task: any = await notion.pages.retrieve({ page_id: taskPageId });
    if (task?.archived) {
      return noStoreJson({ ok: false, error: "task_archived", hint: "Unarchive the task in Notion, then try again." }, 400);
    }
    const props = task?.properties || {};
    const titleProp = Object.values(props).find((p: any) => p?.type === "title") as any;
    const title = (titleProp?.title || [])
      .map((t: any) => t?.plain_text || t?.text?.content || "")
      .join("")
      .trim() || "Task";

    // Try to find an existing active rule for this task (archived pages are usually excluded,
    // but if the API ever returns one, we’ll handle it below).
    const existing: any = await notion.databases.query({
      database_id: rulesDb,
      filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
      page_size: 1,
    });

    const ruleProps: any = {
      "Rule Name": { title: [{ text: { content: title } }] },
      "Task Page ID": { rich_text: [{ type: "text", text: { content: taskPageId } }] },
      "Rule": { select: { name: custom ? "Custom" : rule } },
      "By Day": { multi_select: byday.map((n: string) => ({ name: n })) },
      "Interval": { number: Number.isFinite(interval) ? interval : 1 },
      "Time": { rich_text: time ? [{ type: "text", text: { content: time } }] : [] },
      "Timezone": { rich_text: tz ? [{ type: "text", text: { content: tz } }] : [] },
      "Custom RRULE": { rich_text: custom ? [{ type: "text", text: { content: custom } }] : [] },
      "Active": { checkbox: true },
    };

    if (existing.results?.length) {
      const pageId = existing.results[0].id;
      // If the existing rule page is archived, unarchive it first.
      try { await notion.pages.update({ page_id: pageId, archived: false }); } catch {}
      await notion.pages.update({ page_id: pageId, properties: ruleProps });
      return noStoreJson({ ok: true, updated: true, pageId });
    }

    // Create a fresh rule page
    const created: any = await notion.pages.create({
      parent: { database_id: rulesDb },
      properties: ruleProps,
    });
    return noStoreJson({ ok: true, created: true, pageId: created.id });
  } catch (e: any) {
    // Surface the exact Notion message, which includes "Can't edit block that is archived" if that’s the case.
    return noStoreJson({ ok: false, error: "save_rule_failed", detail: e?.message || String(e) }, 500);
  }
}
