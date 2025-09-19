// app/api/admin/disconnect/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { redisDel, redisGet } from "../../_utils";
import { getSidFromRequest } from "../../_session";

export async function POST(req: Request) {
  const u = new URL(req.url);
  // scope=all will also remove the user-wide token (tok:user:<email>)
  const scope = u.searchParams.get("scope"); // "sid" (default) | "all"

  const sid = await getSidFromRequest();
  // Clear cookies even if no SID found (iframe/cookie edge cases)
  if (!sid) {
    const res = noStoreJson({ ok: true, note: "no sid" });
    try {
      res.cookies.set("sid", "", { path: "/", maxAge: 0 });
      res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
    } catch {}
    return res;
  }

  // Read email bound to this SID (do this BEFORE deleting the binding)
  const email = await redisGet<string>(`auth:sid:${sid}`).catch(() => null);

  const cleared: string[] = [];
  try { await redisDel(`tok:${sid}`); cleared.push(`tok:${sid}`); } catch {}
  try { await redisDel(`auth:sid:${sid}`); cleared.push(`auth:sid:${sid}`); } catch {}

  if (scope === "all" && email) {
    try { await redisDel(`tok:user:${email}`); cleared.push(`tok:user:${email}`); } catch {}
  }

  const res = noStoreJson({ ok: true, cleared, scope: scope || "sid" });
  try {
    res.cookies.set("sid", "", { path: "/", maxAge: 0 });
    res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
  } catch {}
  return res;
}