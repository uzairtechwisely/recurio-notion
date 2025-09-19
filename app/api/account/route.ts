// app/api/account/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet } from "../_utils";

type Account = {
  email?: string | null;
  createdAt?: number;
};

export async function GET() {
  const sid = await getSidFromRequest();
  if (!sid) return noStoreJson({ ok: false, error: "no_sid" }, 401);

  try {
    // If you haven’t created this key yet, this will just be null (which is fine).
    const account = await redisGet<Account>(`acct:${sid}`);
    return noStoreJson({ ok: true, sid, account: account || null });
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "account_lookup_failed", detail: e?.message || String(e) },
      500
    );
  }
}
