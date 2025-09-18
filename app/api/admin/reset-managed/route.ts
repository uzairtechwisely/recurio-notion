import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet, redisDel, notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../../_utils";

export async function POST() {
  const store = await getCookies();
  const sid = store.get("sid")?.value;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return NextResponse.json({ ok:false, error:"Not connected" }, { status:401 });

  const notion = notionClient(tok.access_token);
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";

  await redisDel(`managedpage:${workspaceId}`);
  await redisDel(`rulesdb:${workspaceId}`);

  // Recreate immediately so user gets IDs back
  const ids = await ensureManagedContainers(notion, workspaceId);
  return NextResponse.json({ ok:true, ...ids });
}
