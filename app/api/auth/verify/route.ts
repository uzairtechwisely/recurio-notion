export const runtime = "nodejs";
export const fetchCache = "force-no-store";

import { noStoreJson, badRequest, unauthorized, okJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet, redisDel, redisSet } from "../_utils";
import crypto from "crypto";

function sha(input: string, pepper: string) {
  return crypto.createHash("sha256").update(input + (pepper || "")).digest("hex");
}

export async function POST(req: Request) {
  noStoreJson();

  const sid = await getSidFromRequest();
  if (!sid) return badRequest("missing_sid");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid_json");
  }

  // accept both keys and coerce to string
  const raw = body?.otp ?? body?.code ?? "";
  const otp = String(raw).trim();

  if (!/^\d{6}$/.test(otp)) {
    return badRequest("invalid_otp_format");
  }

  const otpKey = `otp:${sid}`;
  const emailKey = `email:${sid}`;

  const stored = await redisGet<string>(otpKey);
  if (!stored) return unauthorized("no_otp_for_sid");

  const pepper = process.env.OTP_PEPPER || "";

  // compare against plain and hashed variants
  const candidates = new Set<string>([otp, sha(otp, pepper)]);
  if (!candidates.has(stored)) {
    return unauthorized("invalid_code");
  }

  const email = (await redisGet<string>(emailKey)) || null;

  // promote to a session (1 week TTL)
  await redisDel(otpKey);
  await redisSet(`session:${sid}`, JSON.stringify({ sid, email, ts: Date.now() }), 60 * 60 * 24 * 7);

  return okJson({ ok: true, email });
}