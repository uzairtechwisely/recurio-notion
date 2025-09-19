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

  if (!code || !inboundState || !stateCookie || inboundState !== stateCookie || !sid) {
    return noStoreJson({ ok: false, error: "Bad OAuth state" }, 400);
  }

  try {
    // 1) Exchange code → token
    const tok = await exchangeCodeForToken(code, `${origin}/api/oauth/callback`);

    // 2) Persist token (session + latest fallback for iframe/popup)
    await redisSet(`tok:${sid}`, tok);
    await redisSet(`tok:latest`, tok);

    // 3) Sanity probe via REST (SDK versions differ on users.me())
    const probe = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!probe.ok) {
      const text = await probe.text().catch(() => "");
      throw new Error(`notion_probe_failed ${probe.status}: ${text}`);
    }

    // 4) Redirect to a page that postMessage()'s success and closes (popup/iframe safe)
    return NextResponse.redirect(`${origin}/oauth/done`, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "oauth_callback_failed", detail: e?.message || String(e) },
      500
    );
  }
}
