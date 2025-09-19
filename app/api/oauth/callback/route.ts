// app/api/oauth/callback/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import { exchangeCodeForToken, redisSet } from "../../_utils";
import { adoptTokenForThisSession } from "../../_session";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const origin = u.origin;
  const code = u.searchParams.get("code");
  const inboundState = u.searchParams.get("state");

  if (!code) return noStoreJson({ ok: false, error: "missing_code" }, 400);

  try {
    // 1) Exchange code → token (scoped to this workspace)
    const tok = await exchangeCodeForToken(code, `${origin}/api/oauth/callback`);

    // 2) If we trust the flow (state matches) we can bind to the current session.
    //    Either way, adoptTokenForThisSession(tok) will set/refresh the sid cookie
    //    and store tok under tok:<sid> (your _session.ts implementation).
    const jar = await getCookies();
    const stateCookie = jar.get("oauth_state")?.value || null;
    const sidCookie   = jar.get("sid")?.value || null;

    if (inboundState && stateCookie && inboundState === stateCookie && sidCookie) {
      await adoptTokenForThisSession(tok);
    } else {
      // No trusted state/sid? Still adopt so the popup session holds the token.
      await adoptTokenForThisSession(tok);
    }

    // (Optional) keep a convenience pointer for last successful token
    await redisSet("tok:latest", tok);

    // 3) Create a short-lived handoff so the opener/parent can adopt on its own session.
    const handoff = crypto.randomUUID();
    await redisSet(`handoff:${handoff}`, tok); // your /api/session/adopt should DEL this key after use

    // 4) Redirect to the broadcaster (HTML that postMessage’s {handoff} and closes).
    return NextResponse.redirect(
      `${origin}/api/oauth/done?h=${encodeURIComponent(handoff)}`,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "oauth_callback_failed", detail: e?.message || String(e) },
      500
    );
  }
}
