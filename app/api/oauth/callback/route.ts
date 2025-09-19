// app/api/oauth/callback/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import { exchangeCodeForToken, redisSet } from "../../_utils";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const origin = u.origin;
  const code = u.searchParams.get("code");
  const inboundState = u.searchParams.get("state");

  const jar = await getCookies();
  const stateCookie = jar.get("oauth_state")?.value || null;
  const sid = jar.get("sid")?.value || null;

  if (!code) return noStoreJson({ ok: false, error: "missing_code" }, 400);

  try {
    // Exchange code → token
    const tok = await exchangeCodeForToken(code, `${origin}/api/oauth/callback`);

    // If state & sid are good, bind to this sid now (best effort)
    if (inboundState && stateCookie && inboundState === stateCookie && sid) {
      try {
        await redisSet(`tok:${sid}`, tok);
        await redisSet("tok:latest", tok);
      } catch {}
    }

    // Always create a handoff id for iframe-safe adoption
    const handoff = crypto.randomUUID();
    await redisSet(`handoff:${handoff}`, tok); // we’ll delete it on adopt

   
// Redirect to broadcaster (it will postMessage {handoff} and close)
return NextResponse.redirect(
  `${origin}/api/oauth/done?h=${encodeURIComponent(handoff)}`,
  { headers: { "Cache-Control": "no-store" } }
);
  } catch (e: any) {
    return noStoreJson({ ok: false, error: "oauth_callback_failed", detail: e?.message || String(e) }, 500);
  }
}
