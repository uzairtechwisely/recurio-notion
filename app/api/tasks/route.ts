import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet, notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return NextResponse.json({ tasks: [], meta: {} });

  // token
  const store = await getCookies();
  const sid = store.get("sid")?.value || null;
  const tok =
    (sid && await redisGet<any>(`tok:${sid}`)) ||
    await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ tasks: [], meta: {} });

  const notion = notionClient(tok.access_token);

  // 1) DB schema → detect key props
  const schema: any = await notion.databases.retrieve({ database_id: dbId });
  const props = schema.properties || {};
  const titleProp = Object.keys(props).find(k => props[k].type === "title") || "Name";
  const dueProp   = Object.keys(props).find(k => props[k].type === "date")  || null;
  const doneProp  = Object.keys(props).find(k => props[k].type === "checkbox") || null;
  const statusProp= Object.keys(props).find(k => props[k].type === "status") || null;

  // 2) Pull tasks
  const query: any = { database_id: dbId, page_size: 50 };
  if (dueProp) query.sorts = [{ property: dueProp, direction: "ascending" }];
  const res: any = await notion.databases.query(query);

  // 3) Build a set of Task Page IDs that have an ACTIVE rule
  const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
  const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);
  const rules:any = await notion.databases.query({
    database_id: rulesDbId,
    filter: { property: "Active", checkbox: { equals: true } },
    page_size: 100
  });
  const ruleSet = new Set<string>(
    rules.results
      .map((r:any) => r.properties?.["Task Page ID"]?.rich_text?.[0]?.plain_text)
      .filter(Boolean)
  );

  // 4) Map rows + flag hasRule
  const tasks = res.results.map((p: any) => ({
    id: p.id,
    name: p.properties?.[titleProp]?.title?.[0]?.plain_text || "Untitled",
    due: dueProp ? (p.properties?.[dueProp]?.date?.start || null) : null,
    done: doneProp ? !!p.properties?.[doneProp]?.checkbox : false,
    parentDb: dbId!,
    hasRule: ruleSet.has(p.id)
  }));

  return NextResponse.json({ tasks, meta: { titleProp, dueProp, doneProp, statusProp } });
}
