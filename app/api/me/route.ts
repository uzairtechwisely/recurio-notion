export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { NextResponse } from "next/server";
import { redisGet } from "../_utils";

export async function GET() {
  const sid = (await getCookies()).get("sid")?.value || null;

  // Prefer per-session token, but allow fallback for embedded reconnect UX
  const tokBySid = sid ? await redisGet<any>(`tok:${sid}`) : null;
  const tokLatest = await redisGet<any>("tok:latest");
  const tok = tokBySid || tokLatest;

  if (!tok?.access_token) {
    const res = NextResponse.json({ connected: false });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    return res;
  }

  try {
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const res = NextResponse.json({
      connected: resp.ok,
      source: tokBySid ? "sid" : "latest",
    });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    return res;
  } catch {
    const res = NextResponse.json({ connected: false });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    return res;
  }
}
