// app/api/_session.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies, headers as getHeaders } from "next/headers";
import { redisGet, redisSet } from "./_utils";

/** Read the current SID, preferring header (iframe) over cookie. */
export async function getSidFromRequest(): Promise<string | null> {
  try {
    const h = await getHeaders();
    const fromHeader = h.get("x-recurio-sid");
    if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  } catch {}
  try {
    const jar = await getCookies();
    const fromCookie = jar.get("sid")?.value || null;
    if (fromCookie) return fromCookie;
  } catch {}
  return null;
}

/** Return the stored OAuth token for this request (or null). */
export async function getTokenFromRequest<T = any>(): Promise<T | null> {
  const sid = await getSidFromRequest();
  if (sid) {
    const tok = await redisGet<T>(`tok:${sid}`);
    if (tok) return tok;
  }
  // last resort for iframes: most recent successful token
  const latest = await redisGet<T>("tok:latest");
  return latest || null;
}

/**
 * Keep your old import working.
 * Stores the token under the current SID (or a new one) and also at tok:latest.
 * Returns the SID string (you can ignore it where you already call this).
 */
export async function adoptTokenForThisSession(tok?: any): Promise<string | null> {
  if (!tok) return null;
  let sid: string | null = null;
  try {
    const jar = await getCookies();
    sid = jar.get("sid")?.value || null;
  } catch {}
  if (!sid) sid = nanoid(18);

  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok);

  // best-effort cookie write (won’t work in some iframe contexts; header fallback covers it)
  try {
    const jar = await getCookies();
    // @ts-ignore — Next sets cookies on the response implicitly for route handlers using NextResponse;
    // here we just ensure the jar is aware for subsequent handlers in same request scope.
    jar.set("sid", sid, { httpOnly: true, sameSite: "Lax", path: "/" });
  } catch {}

  return sid;
}

/** Simple nanoid (not cryptographic). */
function nanoid(n = 21) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
