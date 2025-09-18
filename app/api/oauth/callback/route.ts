// app/api/oauth/callback/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson, noStoreRedirect } from "../../_http";
import { redisSet } from "../../_utils";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const inboundState = u.searchParams.get("state");

  const jar = await getCookies();
  const stateCookie = jar.get("oauth_state")?.value || null;
  const sid = jar.get("sid")?.value || null;

  if (!code || !inboundState || !stateCookie || inboundState !== stateCookie || !sid) {
    return noStoreJson({ ok: false, error: "Bad OAuth state" }, 400);
  }

  const clientId = process.env.NOTION_CLIENT_ID!;
  const clientSecret = process.env.NOTION_CLIENT_SECRET!;
  const redirectUri = `${process.env.APP_URL}/api/oauth/callback`;

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => "");
    return noStoreJson({ ok: false, error: `Token exchange failed: ${t || tokenRes.status}` }, 400);
  }

  const tok = await tokenRes.json();

  // Store per-session token; also update tok:latest for /me fallback
  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok);

  // Clear state cookie and bounce to app
  const res = noStoreRedirect(process.env.APP_URL!);
  res.cookies.set({ name: "oauth_state", value: "", path: "/", maxAge: 0 });
  return res;
}
