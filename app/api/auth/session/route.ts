export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";
import { redisGet } from "../_utils";

export async function GET() {
  const sid = await getSidFromRequest();
  const user = sid ? await redisGet(`session:user:${sid}`) : null;
  return noStoreJson({ ok: true, sid: sid ?? null, user });
}