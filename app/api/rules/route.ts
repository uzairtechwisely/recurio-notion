export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../_http";
import { redisGet, notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

export async function POST(req: Request) {
  const sid = (await getCookies()).get("sid")?.value;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return noStoreJson({ ok:false, error:"Not connected" }, 401);

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);

  const body = await req.json().catch(() => ({}));
  const taskPageId = String(body.taskPageId || "").trim();
  const ruleName = `Rule for ${taskPageId.slice(0, 6)}`;

  const rule = String(body.rule || "Weekly");
  const byday = String(body.byday || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const interval = Number(body.interval || 1);
  const time = String(body.time || "");
  const tz = String(body.tz || "");
  const custom = String(body.custom || "");

  if (!taskPageId) return noStoreJson({ ok:false, error:"Missing taskPageId" }, 400);

  // Upsert: find active rule for this page id
  const existing:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: {
      and: [
        { property: "Active", checkbox: { equals: true } },
        { property: "Task Page ID", rich_text: { equals: taskPageId } }
      ]
    },
    page_size: 1
  });

  const props: any = {
    "Rule Name": { title: [{ text: { content: ruleName } }] },
    "Task Page ID": { rich_text: [{ text: { content: taskPageId } }] },
    "Rule": { select: { name: rule } },
    "By Day": { multi_select: byday.map((n: string) => ({ name: n })) },
    "Interval": { number: interval },
    "Time": { rich_text: time ? [{ text: { content: time } }] : [] },
    "Timezone": { rich_text: tz ? [{ text: { content: tz } }] : [] },
    "Custom RRULE": { rich_text: custom ? [{ text: { content: custom } }] : [] },
    "Active": { checkbox: true },
  };

  if (existing.results?.length) {
    await notion.pages.update({ page_id: existing.results[0].id, properties: props });
    return noStoreJson({ ok:true, updated:true });
  } else {
    await notion.pages.create({ parent: { database_id: rulesDbId }, properties: props });
    return noStoreJson({ ok:true, created:true });
  }
}
