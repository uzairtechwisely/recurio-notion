import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export async function GET() {
  const clientId = process.env.NOTION_CLIENT_ID!;
  const redirectUri = encodeURIComponent(`${process.env.APP_URL}/api/oauth/callback`);
  const state = nanoid();

  const url =
    `https://api.notion.com/v1/oauth/authorize` +
    `?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${redirectUri}&state=${state}`;

  const res = NextResponse.redirect(url);
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "Lax", path: "/" });
  res.cookies.set("sid", nanoid(), { httpOnly: true, sameSite: "Lax", path: "/" });
  return res;
}
