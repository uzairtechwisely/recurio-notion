// app/api/session/adopt/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import { redisDel, redisGet, redisSet } from "../../_utils";

export async function POST(req: Request) {
  const u = new URL(req.url);
  const handoff = u.searchParams.get("h");
  if (!handoff) return noStoreJson({ ok: false, error: "missing_handoff" }, 400);

  const tok = await redisGet<any>(`handoff:${handoff}`);
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "handoff_not_found" }, 404);

  const jar = await getCookies();
  const sid = jar.get("sid")?.value || crypto.randomUUID();

  // Bind to this origin’s session
  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok);
  await redisDel(`handoff:${handoff}`);

  const res = noStoreJson({ ok: true, adopted: true });
  // Ensure the caller has a first-party sid cookie
  // (SameSite=Lax is enough for top-level, but None+Secure is also fine)
  (res as any).cookies?.set?.("sid", sid, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  return res;
}
