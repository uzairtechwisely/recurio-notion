// app/api/oauth/callback/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { NextResponse } from "next/server";
import { redisSet } from "../../_utils";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const origin = u.origin;
  const code = u.searchParams.get("code");
  const inboundState = u.searchParams.get("state");

  const jar = await getCookies();
  const stateCookie = jar.get("oauth_state")?.value || null;
  const sid = jar.get("sid")?.value || null;

  if (!code || !inboundState || !stateCookie || inboundState !== stateCookie || !sid) {
    return new NextResponse(JSON.stringify({ ok: false, error: "Bad OAuth state" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  }

  const clientId = process.env.NOTION_CLIENT_ID!;
  const clientSecret = process.env.NOTION_CLIENT_SECRET!;
  const redirectUri = `${origin}/api/oauth/callback`;

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => "");
    return new NextResponse(JSON.stringify({ ok: false, error: `Token exchange failed: ${t || tokenRes.status}` }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  }

  const tok = await tokenRes.json();
  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok);

  // Clear state cookie
  const clear = new NextResponse(
    `<!doctype html><meta charset="utf-8" />
    <script>
      try { window.opener && window.opener.postMessage({ type: 'recurio:oauth-complete' }, '*'); } catch(e) {}
      try { window.close(); } catch(e) {}
      setTimeout(function(){ location.replace(${JSON.stringify(origin)}); }, 800);
    </script>
    <p>You can close this window.</p>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
  clear.cookies.set({ name: "oauth_state", value: "", path: "/", maxAge: 0 });
  return clear;
}
