// app/api/admin/reset-managed/route.ts
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

  const body = await req.json().catch(() => ({} as any));
  const mode = (body.mode || "").trim(); // "archive" or ""

  try {
    const workspaceId = getWorkspaceIdFromToken(tok) || tok.workspace_id;
    const { dbId, pageId, panelId } = await ensureManagedContainers(notion, workspaceId);
    if (!dbId || !pageId) return noStoreJson({ ok: false, error: "ensure failed" }, 500);

    if (mode === "archive") {
      // Archive all active rule rows (soft delete)
      const rr: any = await notion.databases.query({
        database_id: dbId,
        filter: { property: "Active", checkbox: { equals: true } },
        page_size: 100,
      });
      let archived = 0;
      for (const r of rr?.results || []) {
        await notion.pages.update({ page_id: (r as any).id, archived: true });
        archived++;
      }
      return noStoreJson({ ok: true, archived });
    }

    return noStoreJson({ ok: true, pageId, dbId, panelId });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || "reset failed" }, 500);
  }
}
