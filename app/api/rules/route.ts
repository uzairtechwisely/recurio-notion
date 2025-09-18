// app/api/rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

export async function POST(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "no token" }, 401);
  const notion = notionClient(tok.access_token);

  const body = await req.json().catch(() => ({} as any));
  const taskPageId = (body.taskPageId || "").trim();
  const rule = (body.rule || "").trim() || "Weekly";
  const byday = String(body.byday || "").split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
  const interval = Number(body.interval || 1);
  const time = (body.time || "").trim();
  const tz = (body.tz || "").trim();
  const custom = (body.custom || "").trim();

  if (!taskPageId) return noStoreJson({ ok: false, error: "missing taskPageId" }, 400);

  try {
    const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
    if (!workspaceId) return noStoreJson({ ok: false, error: "no workspace id" }, 400);

    const { dbId: rulesDb } = await ensureManagedContainers(notion, workspaceId);
    if (!rulesDb) return noStoreJson({ ok: false, error: "rules db missing" }, 500);

    const task: any = await notion.pages.retrieve({ page_id: taskPageId });
    const titleProp = Object.values(task.properties || {}).find((p: any) => p?.type === "title") as any;
    const title = (titleProp?.title || []).map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Task";

    const existing: any = await notion.databases.query({
      database_id: rulesDb,
      filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
      page_size: 1,
    });

    const props: any = {
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
      await notion.pages.update({ page_id: pageId, properties: props });
      return noStoreJson({ ok: true, updated: true, pageId });
    } else {
      const created: any = await notion.pages.create({
        parent: { database_id: rulesDb },
        properties: props,
      });
      return noStoreJson({ ok: true, created: true, pageId: created.id });
    }
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || "failed to save rule" }, 500);
  }
}
