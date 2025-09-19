export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { getSidFromRequest } from "../_session";

export async function GET() {
  const sid = await getSidFromRequest();
  return noStoreJson({ ok: true, sid: sid || null });
}
