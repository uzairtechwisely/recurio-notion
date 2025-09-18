import { NextResponse } from "next/server";
import { redisGet, notionClient } from "../_utils";
import { cookies as getCookies } from "next/headers";

export async function GET(req: Request) {
  const dbId = new URL(req.url).searchParams.get("db");
  if (!dbId) return NextResponse.json({ tasks: [], meta: {} });

  const store = await getCookies();
  const sid = store.get("sid")?.value;
  const tok =
    (sid && await redisGet<any>(`tok:${sid}`)) ||
    await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ tasks: [], meta: {} });

  const notion = notionClient(tok.access_token);

  // 1) Read the DB schema and auto-detect key properties
  const schema: any = await notion.databases.retrieve({ database_id: dbId });
  const props = schema.properties || {};
  const titleProp = Object.keys(props).find(k => props[k].type === "title") || "Name";
  const dueProp   = Object.keys(props).find(k => props[k].type === "date")  || null;
  const doneProp  = Object.keys(props).find(k => props[k].type === "checkbox") || null;

  // 2) Query rows (sort by the detected date prop if present)
  const query: any = { database_id: dbId, page_size: 50 };
  if (dueProp) query.sorts = [{ property: dueProp, direction: "ascending" }];
  const res: any = await notion.databases.query(query);

  // 3) Map rows using the detected property names
  const tasks = res.results.map((p: any) => ({
    id: p.id,
    name: p.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled",
    due: dueProp ? (p.properties?.[dueProp]?.date?.start || null) : null,
    done: doneProp ? !!p.properties?.[doneProp]?.checkbox : false,
    parentDb: dbId,
  }));

  return NextResponse.json({ tasks, meta: { titleProp, dueProp, doneProp } });
}
