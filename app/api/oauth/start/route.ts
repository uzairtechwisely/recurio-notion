export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies } from "next/headers";
import { noStoreRedirect } from "../../_http";
import { nanoid } from "nanoid";

export async function GET() {
  const clientId = process.env.NOTION_CLIENT_ID!;
  const redirectUri = `${process.env.APP_URL}/api/oauth/callback`;

  const state = nanoid();
  const sid = cookies().get("sid")?.value || nanoid();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });

  const url = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  const res = noStoreRedirect(url);

  // httpOnly cookies for state + sid
  res.cookies.set({ name: "oauth_state", value: state, httpOnly: true, sameSite: "lax", path: "/" });
  res.cookies.set({ name: "sid", value: sid, httpOnly: true, sameSite: "lax", path: "/" });

  return res;
}
