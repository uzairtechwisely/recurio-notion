export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet } from "../_utils";

export async function GET() {
  const sid = await getSidFromRequest();
  if (!sid) return noStoreJson({ ok: true, authed: false, sid: null, email: null });

  const acct = await redisGet<{ email?: string }>(`acct:${sid}`);
  return noStoreJson({ ok: true, authed: !!acct, sid, email: acct?.email || null });
}
