// app/api/me/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { headers as getHeaders } from "next/headers";
import { noStoreJson } from "../../_http";
import { getTokenFromRequest, getSidFromRequest } from "../../_session";

export async function GET() {
  // Figure out how this request is carrying session
  const hdrs = await getHeaders();
  const hasHeaderSid = !!hdrs.get("x-recurio-session");
  const sid = await getSidFromRequest();

  // Prefer header (iframe/popup), then cookie SID, else it's the fallback (“latest”)
  const via = hasHeaderSid ? "header" : (sid ? "sid" : "adopted-latest");

  // Read the token (works for header/cookie “sid”, with safe fallback if you implemented it)
  const tok = await getTokenFromRequest<any>();
  if (!tok?.access_token) {
    return noStoreJson({ connected: false, via }, 200);
  }

  // Validate token with Notion (handles revoked/removed connections)
  try {
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    return noStoreJson({ connected: resp.ok, via }, 200);
  } catch (e: any) {
    return noStoreJson(
      { connected: false, via, error: e?.message || "probe_failed" },
      200
    );
  }
}