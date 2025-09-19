export const runtime = "edge";
export const fetchCache = "force-no-store";

import { noStoreJson, badRequest } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisSet } from "../_utils";

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const email = (body?.email ?? "").toString().trim().toLowerCase();
  if (!email || !isEmail(email)) return badRequest("invalid_email");

  const sid = await getSidFromRequest();
  if (!sid) return badRequest("missing_sid_call_/api/session/new_first");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // store pending email + otp
  await redisSet(`auth:email:${sid}`, email, 60 * 15);
  await redisSet(`auth:otp:${sid}`, otp, 60 * 10);

  const showOtp = process.env.SHOW_OTP_IN_RESPONSE === "1";
  return noStoreJson({ ok: true, sid, email, ...(showOtp && { otp }) });
}