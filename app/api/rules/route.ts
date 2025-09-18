import { NextResponse } from "next/server";
import { redisSet, redisSAdd } from "../_utils";

export async function POST(req: Request) {
  const body = await req.json();
  const { taskPageId, dbId, rule, byday, interval, time, tz, custom } = body || {};
  if (!taskPageId || !dbId || !rule) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  // store rule under rule:<page_id> and index it for the worker
  const cfg = {
    dbId, rule,
    byday: (byday || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    interval: Number(interval || 1),
    time: time || "",
    tz: tz || "",
    custom: custom || ""
  };
  await redisSet(`rule:${taskPageId}`, cfg);
  await redisSAdd("rules:index", taskPageId);

  return NextResponse.json({ ok: true });
}
