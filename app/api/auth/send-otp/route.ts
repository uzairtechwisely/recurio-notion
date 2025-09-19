export const fetchCache = "force-no-store";

import { noStoreJson, badRequest } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet } from "../_utils";

/**
 * Placeholder "send" endpoint. In prod, wire your email provider here.
 * For now we just confirm we have email+otp, and (optionally) echo otp for testing.
 */
export async function POST() {
  const sid = await getSidFromRequest();
  if (!sid) return badRequest("missing_sid");

  const email = await redisGet<string>(`auth:email:${sid}`);
  const otp = await redisGet<string>(`auth:otp:${sid}`);
  if (!email || !otp) return badRequest("no_pending_otp");

  const showOtp = process.env.SHOW_OTP_IN_RESPONSE === "1";
  return noStoreJson({ ok: true, delivered: !showOtp, email, ...(showOtp && { otp }) });
}