import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import {
  redisGet, redisDel, notionClient,
  ensureManagedContainers, getWorkspaceIdFromToken
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
  const store = await getCookies();
  const sid = store.get("sid")?.value;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return NextResponse.json({ ok:false, error:"Not connected" }, { status:401 });

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";

  // body: { mode?: "archive" | "recreate" }
  let mode: "archive" | "recreate" = "recreate";
  try {
    const j = await req.json().catch(() => ({}));
    if (j?.mode === "archive") mode = "archive";
  } catch { /* ignore */ }

  // ensure (and get) current containers
  const ids = await ensureManagedContainers(notion, workspaceId);
  const nowISO = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

  if (mode === "archive") {
    const archived = await archiveAllRows(notion, ids.dbId);
    return NextResponse.json({ ok:true, mode, archived, rulesDbId: ids.dbId });
  }

  // mode === "recreate": rename old DB, clear cache, create a fresh one
  try {
    await notion.databases.update({
      database_id: ids.dbId,
      title: [{ type: "text", text: { content: `Recurrence Rules (Managed) — OLD ${nowISO}` } }]
    } as any);
  } catch { /* rename might fail; continue */ }

  await redisDel(`rulesdb:${workspaceId}`);
  await redisDel(`managedpage:${workspaceId}`);

  const fresh = await ensureManagedContainers(notion, workspaceId);
  return NextResponse.json({ ok:true, mode, old: ids, fresh });
}
