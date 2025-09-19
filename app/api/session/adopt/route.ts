// app/api/session/adopt/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redisGet, redisSet } from "../../_utils";

function nanoid(n = 21) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  const h = u.searchParams.get("h") || "";
  if (!h) return NextResponse.json({ ok: false, error: "missing_h" }, { status: 400 });

  const tok = await redisGet<any>(`hand:${h}`);
  if (!tok?.access_token) {
    return NextResponse.json({ ok: false, error: "handoff_not_found" }, { status: 404 });
  }

  // choose incoming sid (optional) or mint new
  const jar = await cookies();
  const existingSid = jar.get("sid")?.value || null;
  const sid = existingSid || nanoid(18);

  // persist
  await redisSet(`tok:${sid}`, tok);
  await redisSet(`tok:latest`, tok);

  // set cookie if possible (won’t work in some iframe contexts; header fallback will be used)
  const res = NextResponse.json({ ok: true, sid });
  try { res.cookies.set("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" }); } catch {}
  return res;
}
