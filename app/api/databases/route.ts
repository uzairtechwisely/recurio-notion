export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../_http";
import { redisGet, notionClient } from "../_utils";

export async function GET() {
  const sid = (await getCookies()).get("sid")?.value;
  const tok = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (!tok?.access_token) return noStoreJson({ databases: [] }, 401);

  const notion = notionClient(tok.access_token);
  const res: any = await notion.search({ filter: { value: "database", property: "object" } });
  const databases = (res.results || []).map((d: any) => ({
    id: d.id, title: d.title?.[0]?.plain_text || d.title?.[0]?.text?.content || "Untitled DB",
  }));
  return noStoreJson({ databases });
}
