// app/api/oauth/start/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export async function GET(req: Request) {
  const base = process.env.APP_URL || new URL(req.url).origin;
  const redirectUri = `${base}/api/oauth/callback`;

  const clientId = process.env.NOTION_CLIENT_ID!;
  const state = nanoid();

  const jar = await getCookies();
  const sid = jar.get("sid")?.value || nanoid();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });

  const authUrl = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;

  const res = NextResponse.redirect(authUrl, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set({ name: "oauth_state", value: state, httpOnly: true, sameSite: "lax", path: "/" });
  res.cookies.set({ name: "sid", value: sid,   httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
