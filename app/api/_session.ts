// app/api/_session.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies, headers as getHeaders } from "next/headers";
import { redisGet, redisSet } from "./_utils";

/**
 * Read the current SID, preferring an iframe/popup header over cookies.
 * Supports both x-recurio-sid (current) and x-recurio-session (back-compat).
 */
export async function getSidFromRequest(): Promise<string | null> {
  try {
    const h = await getHeaders();
    const fromHeader =
      h.get("x-recurio-sid") || h.get("x-recurio-session") || null;
    if (fromHeader && String(fromHeader).trim()) {
      return String(fromHeader).trim();
    }
  } catch {}
  try {
    const jar = await getCookies();
    const fromCookie = jar.get("sid")?.value || null;
    if (fromCookie) return fromCookie;
  } catch {}
  return null;
}

/**
 * Return the stored OAuth token for this request (or null).
 * By default we keep your previous behavior: fall back to "tok:latest".
 * To disable that auto-connect, set env RECURIO_USE_LATEST_FALLBACK=false.
 */
const USE_LATEST_FALLBACK =
  (process.env.RECURIO_USE_LATEST_FALLBACK ?? "true").toLowerCase() !== "false";

/** Return the stored OAuth token for this request (or null). */
export async function getTokenFromRequest<T = any>(): Promise<T | null> {
  const sid = await getSidFromRequest();
  if (sid) {
    const tok = await redisGet<T>(`tok:${sid}`);
    if (tok) return tok;
  }
  // Optional fallback (disabled by default) to avoid any cross-user leakage
  if (process.env.ALLOW_LATEST_FALLBACK === "1") {
    const latest = await redisGet<T>("tok:latest");
    if (latest) return latest;
  }
  return null;
}

/**
 * Bind a freshly exchanged Notion token to this browser session.
 * - Ensures a SID (reuses cookie if present, else mints new)
 * - Stores token under tok:<sid> and tok:latest (for optional fallback)
 * - Sets/refreshes the 'sid' cookie (httpOnly, lax)
 * Returns the SID string (or null if no token provided).
 */
export async function adoptTokenForThisSession(tok?: any): Promise<string | null> {
  if (!tok) return null;

  // 1) Reuse existing SID if present; otherwise mint one.
  let sid: string | null = null;
  try {
    const jar = await getCookies();
    sid = jar.get("sid")?.value || null;
  } catch {}
  if (!sid) sid = nanoid(18);

  // 2) Persist token
  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok); // convenience pointer (can be disabled via getTokenFromRequest flag)

  // 3) Best-effort cookie write (works in route handlers/actions)
  try {
    const jar = await getCookies();
    // Next expects lower-case samesite values; avoid type errors.
    jar.set({
      name: "sid",
      value: sid,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // omit `secure` to work on http during early testing; set to true when you’re fully on HTTPS
    });
  } catch {
    // ignore: in non-request contexts cookies() may not be writable
  }

  return sid;
}

/** Simple nanoid (not cryptographic). */
function nanoid(n = 21) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}