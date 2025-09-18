// app/api/databases/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

export async function GET() {
  // adopt token into this session, then make a Notion client
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ databases: [] }, 401);
  const notion = notionClient(tok.access_token);

  try {
    const sr: any = await notion.search({
      filter: { value: "database", property: "object" },
      page_size: 50,
    });

    const databases =
      (sr.results || []).map((d: any) => ({
        id: d.id,
        title:
          d.title?.[0]?.plain_text ||
          d.properties?.title?.title?.[0]?.plain_text ||
          "Untitled",
      })) || [];

    return noStoreJson({ databases });
  } catch (e: any) {
    return noStoreJson(
      { databases: [], error: e?.message || "Could not load databases" },
      500
    );
  }
}
