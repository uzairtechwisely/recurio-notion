// app/api/admin/clear-rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../../_utils";
import { adoptTokenForThisSession } from "../../_session";

export async function POST(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "no token" }, 401);
  const notion = notionClient(tok.access_token);

  const { mode } = await req.json().catch(() => ({ mode: "" as string })); // "deactivate" (default) or "archive"

  try {
    const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
    if (!workspaceId) return noStoreJson({ ok: false, error: "no workspace id" }, 400);

    const { dbId } = await ensureManagedContainers(notion, workspaceId);
    if (!dbId) return noStoreJson({ ok: false, error: "rules db missing" }, 500);

    const rr: any = await notion.databases.query({ database_id: dbId, page_size: 100 });

    let changed = 0;
    for (const r of rr?.results || []) {
      if (mode === "archive") {
        await notion.pages.update({ page_id: (r as any).id, archived: true });
      } else {
        await notion.pages.update({ page_id: (r as any).id, properties: { "Active": { checkbox: false } } });
      }
      changed++;
    }
    return noStoreJson({ ok: true, changed, mode: mode || "deactivate" });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || "clear rules failed" }, 500);
  }
}
