// app/api/session/adopt-connection/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies, headers as getHeaders } from "next/headers";
import { redisGet, redisSet } from "../../_utils";

function nanoid(n = 21) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const cidQs = url.searchParams.get("c");
    const body = await req.json().catch(() => ({}));
    const cid = cidQs || body?.c;
    if (!cid) {
      return NextResponse.json(
        { ok: false, error: "missing_c" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Read existing SID (header first, then cookie), or mint a new one
    let sid: string | null = null;
    try { const h = await getHeaders(); sid = h.get("x-recurio-sid"); } catch {}
    if (!sid) { try { const jar = await getCookies(); sid = jar.get("sid")?.value || null; } catch {} }
    if (!sid) sid = nanoid(18);

    // Look up saved connection token
    const tok = await redisGet<any>(`conn:${cid}`);
    if (!tok?.access_token) {
      return NextResponse.json(
        { ok: false, error: "unknown_conn" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Bind this SID -> token
    await redisSet(`tok:${sid}`, tok);

    // Set cookie so subsequent requests in this iframe/tab carry the SID
    const res = NextResponse.json(
      { ok: true, adopted: true, sid, cid },
      { headers: { "Cache-Control": "no-store" } }
    );
    try {
      res.cookies.set("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" });
    } catch {}
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "adopt_fail", detail: e?.message || String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}