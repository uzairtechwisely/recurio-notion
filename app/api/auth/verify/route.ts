export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet, redisDel, redisSet } from "../_utils";

export async function POST(req: Request) {
  const sid = await getSidFromRequest();
  if (!sid) return noStoreJson({ ok: false, error: "no_sid" }, 400);

  let code = "";
  try { const b = await req.json(); code = String(b?.code || "").trim(); } catch {}
  if (!code) return noStoreJson({ ok: false, error: "missing_code" }, 400);

  const rec = await redisGet<{ email: string; code: string }>(`otp:${sid}`);
  if (!rec?.code || !rec?.email) return noStoreJson({ ok: false, error: "no_pending_otp" }, 400);
  if (rec.code !== code) return noStoreJson({ ok: false, error: "invalid_code" }, 401);

  await redisDel(`otp:${sid}`);
  await redisSet(`acct:${sid}`, { email: rec.email, createdAt: Date.now() });
  await redisSet(`sid:byEmail:${rec.email}`, sid); // helpful for re-association

  return noStoreJson({ ok: true, sid, email: rec.email });
}
