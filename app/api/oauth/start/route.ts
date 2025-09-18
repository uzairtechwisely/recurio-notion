export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { cookies as getCookies } from "next/headers";
import { redisSet } from "../../_utils";

export async function GET() {
  const clientId = process.env.NOTION_CLIENT_ID!;
  const redirectUri = encodeURIComponent(`${process.env.APP_URL}/api/oauth/callback`);

  const store = await getCookies();
  const existingSid = store.get("sid")?.value;
  const sid = existingSid || nanoid();
  const state = nanoid();

  // Save the sid server-side, keyed by state (no cookie dependency)
  await redisSet(`oauth:${state}`, { sid, ts: Date.now() });

  const url =
    `https://api.notion.com/v1/oauth/authorize` +
    `?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${redirectUri}&state=${state}`;

  const res = NextResponse.redirect(url);

  // Ensure the browser has a sid for UI calls (not required for OAuth correctness)
  res.cookies.set({
    name: "sid",
    value: sid,
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });

  return res;
}
