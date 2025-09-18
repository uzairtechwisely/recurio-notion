import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { notionClient, redisGet, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";

export async function POST(req: Request) {
  try {
    const store = await getCookies();
    const sid = store.get("sid")?.value;
    const tok = (sid && await redisGet<any>(`tok:${sid}`)) || await redisGet<any>("tok:latest");
    if (!tok?.access_token) return NextResponse.json({ ok:false, error:"Not connected" }, { status:401 });

    const body = await req.json();
    const { taskPageId, dbId, rule, byday, interval, time, tz, custom } = body || {};
    if (!taskPageId || !rule) return NextResponse.json({ ok:false, error:"Missing fields" }, { status:400 });

    const notion = notionClient(tok.access_token);
    const workspaceId = await getWorkspaceIdFromToken(tok) || "default";
    const { dbId: rulesDbId } = await ensureManagedContainers(notion, workspaceId);

    // find existing by Task Page ID
    const existing:any = await notion.databases.query({
      database_id: rulesDbId,
      filter: { property: "Task Page ID", rich_text: { equals: taskPageId } },
      page_size: 1
    });

    const props:any = {
      "Rule Name": { title: [{ text: { content: `Rule for ${taskPageId.slice(0,6)}` } }] },
      "Task Page ID": { rich_text: [{ type: "text", text: { content: taskPageId } }] },
      "Rule": { select: { name: rule } },
      "By Day": { multi_select: (byday || "").split(",").map((s:string)=>s.trim()).filter(Boolean).map((n:string)=>({ name:n })) },
      "Interval": { number: Number(interval || 1) },
      "Time": { rich_text: [{ type: "text", text: { content: time || "" } }] },
      "Timezone": { rich_text: [{ type: "text", text: { content: tz || "" } }] },
      "Custom RRULE": { rich_text: [{ type: "text", text: { content: custom || "" } }] },
      "Active": { checkbox: true }
    };

    if (existing.results?.length) {
      const pageId = existing.results[0].id;
      await notion.pages.update({ page_id: pageId, properties: props });
      return NextResponse.json({ ok:true, updated:true, rulesDbId });
    } else {
      await notion.pages.create({ parent: { database_id: rulesDbId }, properties: props });
      return NextResponse.json({ ok:true, created:true, rulesDbId });
    }
  } catch (e: any) {
    // surface Notion error message if present
    const msg = e?.body?.message || e?.message || "Unknown error";
    return NextResponse.json({ ok:false, error: msg }, { status: 500 });
  }
}
