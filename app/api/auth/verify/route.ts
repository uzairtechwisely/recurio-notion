export const runtime = "edge";
export const fetchCache = "force-no-store";

import { noStoreJson, badRequest, unauthorized } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet, redisDel, redisSet } from "../_utils";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const code = (body?.code ?? "").toString().trim();

  const sid = await getSidFromRequest();
  if (!sid) return badRequest("missing_sid");

  const expected = await redisGet<string>(`auth:otp:${sid}`);
  const email = await redisGet<string>(`auth:email:${sid}`);

  if (!expected || !email) return badRequest("no_otp_pending");
  if (code !== expected) return unauthorized("invalid_code");

  // mark the session as signed in for a week
  await redisSet(`session:user:${sid}`, { email }, 60 * 60 * 24 * 7);
  await redisDel([`auth:otp:${sid}`, `auth:email:${sid}`]);

  return noStoreJson({ ok: true, email });
}