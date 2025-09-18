// app/api/_session.ts
import { cookies as getCookies } from "next/headers";
import { redisGet, redisSet } from "./_utils";

/**
 * Strict session: only use the token mapped to this tab/session's `sid` cookie.
 * No global adoption by default. Can be enabled for dev with ALLOW_ADOPT_LATEST=1.
 */
export async function adoptTokenForThisSession() {
  const allowAdopt = process.env.ALLOW_ADOPT_LATEST === "1";

  const jar = await getCookies();
  let sid = jar.get("sid")?.value || null;

  // 1) Try strict per-session token
  const tokBySid = sid ? await redisGet<any>(`tok:${sid}`) : null;
  if (tokBySid?.access_token) {
    return { sid, tok: tokBySid, source: "sid" as const };
  }

  // 2) Optional: adopt from last known only if explicitly enabled (DEV ONLY)
  if (allowAdopt) {
    const tokLatest = await redisGet<any>("tok:latest");
    if (tokLatest?.access_token) {
      if (!sid) sid = Math.random().toString(36).slice(2);
      await redisSet(`tok:${sid}`, tokLatest);
      return { sid, tok: tokLatest, source: "adopted-latest" as const };
    }
  }

  return { sid, tok: null as any, source: "none" as const };
}
