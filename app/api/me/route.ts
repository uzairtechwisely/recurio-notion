// app/api/me/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { adoptTokenForThisSession } from "../_session";

export async function GET() {
  const { tok, source } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ connected: false, source });

  try {
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    return noStoreJson({ connected: resp.ok, source: resp.ok ? source : "invalid" });
  } catch {
    return noStoreJson({ connected: false, source: "error" });
  }
}
