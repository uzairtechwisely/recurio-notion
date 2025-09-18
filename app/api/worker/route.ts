import { NextResponse } from "next/server";
import { redisGet, redisSMembers, notionClient, buildRRule } from "../_utils";

export async function GET() {
  // use the latest token (single-user MVP)
  const tok = await redisGet<any>("tok:latest");
  if (!tok?.access_token) return NextResponse.json({ processed: 0, created: 0 });

  const notion = notionClient(tok.access_token);

  const pageIds = await redisSMembers("rules:index");
  let processed = 0, created = 0;

  for (const pageId of pageIds) {
    const cfg = await redisGet<any>(`rule:${pageId}`);
    if (!cfg) continue;

    // fetch the page (task)
    const page: any = await notion.pages.retrieve({ page_id: pageId }).catch(() => null);
    if (!page) continue;

    const done = page.properties?.Done?.checkbox;
    const dueStart = page.properties?.Due?.date?.start;
    if (!done || !dueStart) { processed++; continue; }

    // compute next
    const rule = buildRRule(cfg);
    const next = rule.after(new Date(dueStart), true);
    if (!next) { processed++; continue; }

    // avoid duplicate (same Due already exists)
    const parentDb = page.parent?.database_id || cfg.dbId;
    if (!parentDb) { processed++; continue; }

    const dup: any = await notion.databases.query({
      database_id: parentDb,
      filter: { property: "Due", date: { equals: next.toISOString() } },
      page_size: 1
    });

    if (dup.results?.length) { processed++; continue; }

    // create next task
    const title = page.properties?.Name?.title?.[0]?.plain_text || "Untitled";
    await notion.pages.create({
      parent: { database_id: parentDb },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Done: { checkbox: false },
        Due: { date: { start: next.toISOString() } }
      }
    });
    created++; processed++;
  }

  return NextResponse.json({ processed, created });
}
