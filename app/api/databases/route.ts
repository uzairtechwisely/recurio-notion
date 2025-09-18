import { NextResponse } from "next/server";
import { redisGet, notionClient } from "../_utils";
import { cookies as getCookies } from "next/headers";

export async function GET() {
  // prefer session token; fall back to latest
  const store = await getCookies();
  const sid = store.get("sid")?.value;
  const tok = (sid && await redisGet<any>(`tok:${sid}`)) || await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ databases: [] });

  const notion = notionClient(tok.access_token);

  const out: { id: string; title: string }[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const res: any = await notion.search({
      filter: { property: "object", value: "database" },
      start_cursor: cursor || undefined,
      page_size: 25
    });
    res.results.forEach((db: any) => {
      const title = (db.title?.[0]?.plain_text || "Untitled DB");
      out.push({ id: db.id, title });
    });
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  return NextResponse.json({ databases: out });
}
