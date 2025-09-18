export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreRedirect } from "../../_http";
import { nanoid } from "nanoid";

export async function GET(req: Request) {
  const clientId = process.env.NOTION_CLIENT_ID!;
  // Use the real request origin so cookies + callback are same-site
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/callback`;

  const jar = await getCookies();
  const state = nanoid();
  const sid = jar.get("sid")?.value || nanoid();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });

  const url = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  const res = noStoreRedirect(url);

  // httpOnly cookies on THIS origin
  res.cookies.set({ name: "oauth_state", value: state, httpOnly: true, sameSite: "lax", path: "/" });
  res.cookies.set({ name: "sid", value: sid,   httpOnly: true, sameSite: "lax", path: "/" });

  return res;
}
