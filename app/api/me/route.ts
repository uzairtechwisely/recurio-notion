export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet } from "../_utils";

export async function GET() {
  const store = await getCookies();
  const sid = store.get("sid")?.value || null;

  // Look for a session token, then fall back to last successful token (for iframes)
  const tokBySid = sid ? await redisGet<any>(`tok:${sid}`) : null;
  const tokLatest = await redisGet<any>("tok:latest");
  const tok = tokBySid || tokLatest;

  if (!tok?.access_token) return NextResponse.json({ connected: false });

  // Validate token against Notion (handles revoked/removed connection)
  try {
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      cache: "no-store"
    });
    return NextResponse.json({ connected: resp.ok });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
