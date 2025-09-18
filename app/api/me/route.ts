import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet } from "../_utils";

export async function GET() {
  const store = await getCookies();                 // ← await
  const sid = store.get("sid")?.value || null;
  if (!sid) return NextResponse.json({ connected: false });

  const tok = await redisGet(`tok:${sid}`);
  const connected = Boolean((tok as any)?.access_token);
  return NextResponse.json({ connected });
}
