// app/api/debug/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { headers as getHeaders } from "next/headers";
import { noStoreJson } from "../_http";
import { getSidFromRequest, getTokenFromRequest } from "../_session";

export async function GET() {
  const hdrs = await getHeaders();
  const headerSid = hdrs.get("x-recurio-session");
  const cookieSid = await getSidFromRequest();

  // Detect how session is being carried
  const tok = await getTokenFromRequest<any>();
  const token_present = !!tok?.access_token;
  const source =
    headerSid ? "header"
    : cookieSid ? "sid"
    : token_present ? "adopted-latest"
    : "none";

  return noStoreJson({
    sid: headerSid || cookieSid || null,
    token_present,
    source, // "header" | "sid" | "adopted-latest" | "none"
    workspace_id: tok?.workspace_id || null,
    bot_id: tok?.bot_id || null,
  });
}