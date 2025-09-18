// app/api/debug/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { adoptTokenForThisSession } from "../_session";

export async function GET() {
  const { sid, tok, source } = await adoptTokenForThisSession();
  return noStoreJson({
    sid: sid || null,
    token_present: !!tok?.access_token,
    source,                 // "sid" | "adopted-latest" | "none"
    workspace_id: tok?.workspace_id || null,
    bot_id: tok?.bot_id || null,
  });
}
