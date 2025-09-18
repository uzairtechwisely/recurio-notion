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

  // Use the single-options signature + lowercase sameSite
  res.cookies.set({
    name: "oauth_state",
    value: state,
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
  res.cookies.set({
    name: "sid",
    value: nanoid(),
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });

  return res;
}
