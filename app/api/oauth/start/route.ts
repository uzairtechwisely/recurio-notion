// app/api/oauth/start/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";

function makeState(len = 24) {
  const src = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += src[Math.floor(Math.random() * src.length)];
  return s;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const base = process.env.APP_URL || u.origin;
  const redirectUri = `${base}/api/oauth/callback`;
  const clientId = process.env.NOTION_CLIENT_ID!;
  if (!clientId) {
    return new NextResponse(JSON.stringify({ ok: false, error: "missing_client_id" }), {
      status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  const jar = await getCookies();
  const sid = jar.get("sid")?.value || crypto.randomUUID();
  const state = makeState();

  const url = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
  const res = NextResponse.redirect(url);

  // Friendly to iframes (third-party contexts)
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "none", secure: true, path: "/" });
  res.cookies.set("sid", sid,         { httpOnly: true, sameSite: "none", secure: true, path: "/" });

  return res;
}
