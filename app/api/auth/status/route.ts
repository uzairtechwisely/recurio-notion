export const runtime = "edge";
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet } from "../_utils";

export async function GET() {
  const sid = await getSidFromRequest();

  if (!sid) return noStoreJson({ ok: true, status: "no-session" });

  const user = await redisGet(`session:user:${sid}`);
  if (user) return noStoreJson({ ok: true, status: "signed-in", user });

  const email = await redisGet<string>(`auth:email:${sid}`);
  if (email) return noStoreJson({ ok: true, status: "otp-pending", email });

  return noStoreJson({ ok: true, status: "anonymous" });
}