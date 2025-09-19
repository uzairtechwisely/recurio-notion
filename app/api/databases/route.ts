// app/api/databases/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { getTokenFromRequest } from "../../_session";

type Db = { id: string; title: string };

export async function GET() {
  const tok = await getTokenFromRequest<any>();
if (!tok?.access_token) return noStoreJson({ ok: false, error: "no_token" }, 401);
const notion = notionClient(tok.access_token);

  try {
    const out: Db[] = [];
    let cursor: string | null = null;
    do {
      const search: any = await notion.search({
        filter: { property: "object", value: "database" },
        start_cursor: cursor || undefined,
        page_size: 100,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      } as any);
      for (const r of search.results || []) {
        const id = (r as any).id as string;
        const title =
          (r as any)?.title?.[0]?.plain_text ||
          (r as any)?.properties?.title?.title?.[0]?.plain_text ||
          "Untitled";
        const t = title.toLowerCase();
        if (t.includes("recurrence rules (managed)") || t.includes("rules (managed)")) continue; // hide
        out.push({ id, title });
      }
      cursor = search?.next_cursor || null;
    } while (cursor);

    return noStoreJson({ databases: out });
  } catch (e: any) {
    return noStoreJson({ databases: [], error: e?.message || "list_failed" }, 500);
  }
}
