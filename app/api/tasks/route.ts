import { NextResponse } from "next/server";
import { redisGet, notionClient } from "../_utils";
import { cookies as getCookies } from "next/headers";

export async function GET(req: Request) {
  const dbId = new URL(req.url).searchParams.get("db");
  if (!dbId) return NextResponse.json({ tasks: [] });

  const store = await getCookies();
  const sid = store.get("sid")?.value;
  const tok = (sid && await redisGet<any>(`tok:${sid}`)) || await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ tasks: [] });

  const notion = notionClient(tok.access_token);
  const res: any = await notion.databases.query({
    database_id: dbId,
    page_size: 25,
    sorts: [{ property: "Due", direction: "ascending" }]
  });

  const tasks = res.results.map((p: any) => ({
    id: p.id,
    name: p.properties?.Name?.title?.[0]?.plain_text || "Untitled",
    due: p.properties?.Due?.date?.start || null,
    done: !!p.properties?.Done?.checkbox,
    parentDb: dbId
  }));

  return NextResponse.json({ tasks });
}
