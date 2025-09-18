import { adoptTokenForThisSession } from "../_session";   // or "../../_session"
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import {
  redisGet, redisDel, notionClient, ensureManagedContainers, getWorkspaceIdFromToken
} from "../../_utils";

async function archiveAllRows(notion: any, rulesDbId: string) {
  let archived = 0;
  let cursor: string | undefined = undefined;

  while (true) {
    const res: any = await notion.databases.query({
      database_id: rulesDbId,
      page_size: 100,
      start_cursor: cursor
    });
    for (const row of res.results) {
      try {
        await notion.pages.update({ page_id: row.id, archived: true });
        archived++;
      } catch (_) {}
    }
    if (!res.has_more) break;
    cursor = res.next_cursor || undefined;
  }
  return archived;
}

export async function POST(req: Request) {
  const sid = (await getCookies()).get("sid")?.value
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return noStoreJson({ ok:false, error:"Not connected" }, 401);

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";

  let mode: "archive" | "recreate" = "recreate";
  try {
    const j = await req.json().catch(() => ({}));
    if (j?.mode === "archive") mode = "archive";
  } catch {}

  const ids = await ensureManagedContainers(notion, workspaceId);
  const nowISO = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

  if (mode === "archive") {
    const archived = await archiveAllRows(notion, ids.dbId);
    return noStoreJson({ ok:true, mode, archived, rulesDbId: ids.dbId });
  }

  // recreate: rename old DB, clear cache, create fresh
  try {
    await notion.databases.update({
      database_id: ids.dbId,
      title: [{ type: "text", text: { content: `Recurrence Rules (Managed) — OLD ${nowISO}` } }]
    } as any);
  } catch {}

  await redisDel(`rulesdb:${workspaceId}`);
  await redisDel(`managedpage:${workspaceId}`);

  const fresh = await ensureManagedContainers(notion, workspaceId);
  return noStoreJson({ ok:true, mode, old: ids, fresh });
}
