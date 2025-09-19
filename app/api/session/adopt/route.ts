// app/api/session/adopt/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies, headers as getHeaders } from "next/headers";
import { noStoreJson } from "../../_http";
import { redisGet, redisSet, redisDel } from "../../_utils";

export async function POST(req: Request) {
  const u = new URL(req.url);
  const h = u.searchParams.get("h");
  if (!h) return noStoreJson({ ok: false, error: "missing_handoff" }, 400);

  const tok = await redisGet<any>(`handoff:${h}`);
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "handoff_not_found" }, 404);

  // Prefer SID from header (iframe/tab), else cookie, else mint a new one
  let sid: string | null = null;
  try {
    const hdrs = await getHeaders();
    sid = hdrs.get("x-recurio-sid");
    if (sid) sid = String(sid).trim() || null;
  } catch {}
  if (!sid) {
    try {
      const jar = await getCookies();
      sid = jar.get("sid")?.value || null;
    } catch {}
  }
  if (!sid) sid = nanoid(18);

  // Bind token ONLY to this SID; no global tok:latest
  await redisSet(`tok:${sid}`, tok);
  await redisDel(`handoff:${h}`);

  // Best-effort cookie write (iframe may ignore; header will carry SID next calls)
  const res = NextResponse.json({ ok: true, sid }, { headers: { "Cache-Control": "no-store" } });
  try {
    res.cookies.set("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" });
  } catch {}
  return res;
}

/** Tiny non-crypto ID generator (enough for SIDs). */
function nanoid(n = 21) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}