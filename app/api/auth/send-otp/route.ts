export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisSet } from "../_utils";

export async function POST(req: Request) {
  const sid = await getSidFromRequest();
  if (!sid) return noStoreJson({ ok: false, error: "no_sid" }, 400);

  let email = "";
  try { const b = await req.json(); email = String(b?.email || "").trim().toLowerCase(); } catch {}
  if (!email || !email.includes("@")) return noStoreJson({ ok: false, error: "bad_email" }, 400);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await redisSet(`otp:${sid}`, { email, code, createdAt: Date.now() });

  const body: any = { ok: true, sid };
  if (process.env.NODE_ENV !== "production") body.devCode = code;
  return noStoreJson(body);
}
