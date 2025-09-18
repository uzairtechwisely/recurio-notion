// app/api/me/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../_http";
import { redisGet, redisSet } from "../_utils";
import { nanoid } from "nanoid";

export async function GET() {
  const jar = await getCookies();
  let sid = jar.get("sid")?.value || null;
  let newSid = false;
  if (!sid) {
    sid = nanoid();
    newSid = true;
  }

  // Prefer per-session token, fallback to last successful token
  const tokBySid = await redisGet<any>(`tok:${sid}`);
  const tokLatest = await redisGet<any>("tok:latest");

  let tok = tokBySid;
  let source: "sid" | "latest" | "adopted-latest" | "none" = "none";

  if (tokBySid?.access_token) {
    source = "sid";
  } else if (tokLatest?.access_token) {
    // Adopt latest into this session so other routes work
    await redisSet(`tok:${sid}`, tokLatest);
    tok = tokLatest;
    source = "adopted-latest";
  }

  if (!tok?.access_token) {
    const res = noStoreJson({ connected: false, source });
    if (newSid && sid) res.cookies.set({ name: "sid", value: sid, httpOnly: true, sameSite: "lax", path: "/" });
    return res;
  }

  // Validate token (handles revoke/remove)
  const resp = await fetch("https://api.notion.com/v1/users/me", {
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const res = noStoreJson({ connected: resp.ok, source });
  if (newSid && sid) res.cookies.set({ name: "sid", value: sid, httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
