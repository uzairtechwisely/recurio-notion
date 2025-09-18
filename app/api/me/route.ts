import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet } from "../_utils";

export async function GET() {
  const store = await getCookies();
  const sid = store.get("sid")?.value || null;

  const tokBySid = sid ? await redisGet<any>(`tok:${sid}`) : null;
  const tokLatest = await redisGet<any>("tok:latest");     // ← fallback for iframes
  const tok = tokBySid || tokLatest;

  return NextResponse.json({ connected: !!tok?.access_token });
}
