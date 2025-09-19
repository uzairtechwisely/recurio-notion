// app/api/_session.ts  (DROP-IN REPLACEMENT)

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

/** Optionally expose authed email for callers that need it. */
export async function getAuthedEmailFromRequest(): Promise<string | null> {
  const sid = await getSidFromRequest();
  if (!sid) return null;
  const email = await redisGet<string>(`auth:sid:${sid}`);
  return email || null;
}

/** Return the stored OAuth token for this request (or null). */
export async function getTokenFromRequest<T = any>(): Promise<T | null> {
  const sid = await getSidFromRequest();
  if (sid) {
    // 1) direct SID token?
    const tok = await redisGet<T>(`tok:${sid}`);
    if (tok) return tok;

    // 2) if this SID is email-bound, try user bucket and backfill the SID
    const email = await redisGet<string>(`auth:sid:${sid}`);
    if (email) {
      const userTok = await redisGet<T>(`tok:user:${email}`);
      if (userTok) {
        await redisSet(`tok:${sid}`, userTok); // backfill for faster future reads
        return userTok;
      }
    }
  }
  // Optional last resort (kept for compatibility, won’t usually exist anymore)
  const latest = await redisGet<T>("tok:latest");
  return latest || null;
}

/**
 * Legacy helper: keep signature intact for older imports.
 * If a token is provided, store it under the current/minted SID and also under tok:user:<email> if available.
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

  // if caller has already email-bound this SID, mirror to user bucket
  const email = await redisGet<string>(`auth:sid:${sid}`);
  if (email) await redisSet(`tok:user:${email}`, tok);

  try {
    const jar = await getCookies();
    // @ts-ignore
    jar.set("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" });
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