// app/api/admin/clear-rules/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { noStoreJson } from "../../_http";
import {
  notionClient,
  ensureManagedContainers,
  getWorkspaceIdFromToken,
} from "../../_utils";
import { getTokenFromRequest } from "../../_session";

export async function POST(req: Request) {
  try {
    // 1) Get the OAuth token from header/cookie (works in iframe too)
    const tok = await getTokenFromRequest<any>();
    if (!tok?.access_token) {
      return noStoreJson({ ok: false, error: "no_token" }, 401);
    }

    const notion = notionClient(tok.access_token);
    const workspaceId =
      (await getWorkspaceIdFromToken(tok)) || tok.workspace_id || null;

    if (!workspaceId) {
      return noStoreJson({ ok: false, error: "no_workspace" }, 400);
    }

    // 2) Find or create the managed containers; we only need the Rules DB id
    const { dbId } = await ensureManagedContainers(notion, workspaceId);
    if (!dbId) {
      return noStoreJson({ ok: false, error: "no_rules_db" }, 500);
    }

    // 3) Archive (soft delete) all rule rows in the managed Rules DB
    let total = 0;
    let archived = 0;
    let cursor: string | undefined = undefined;

    do {
      const page: any = await notion.databases.query({
        database_id: dbId,
        start_cursor: cursor,
        page_size: 100,
      });
      const results: any[] = page?.results || [];
      total += results.length;

      for (const r of results) {
        if (!r?.archived) {
          try {
            await notion.pages.update({ page_id: r.id, archived: true } as any);
            archived++;
          } catch {
            // ignore per-row failures, continue
          }
        }
      }

      cursor = page?.has_more ? page?.next_cursor : undefined;
    } while (cursor);

    return noStoreJson({ ok: true, total, archived });
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: e?.message || "clear_rules_failed" },
      500
    );
  }
}
