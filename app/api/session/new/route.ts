export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";

// tiny id
function nanoid(n = 18) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = ""; for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random()*abc.length)];
  return s;
}

export async function POST() {
  const sid = nanoid(18);
  const res = NextResponse.json({ ok: true, sid }, { headers: { "Cache-Control": "no-store" } });
  try { res.cookies.set("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" }); } catch {}
  return res;
}