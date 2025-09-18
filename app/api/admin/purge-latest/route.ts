// app/api/admin/purge-latest/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { redisDel } from "../../_utils";

export async function POST() {
  try { if (typeof redisDel === "function") await redisDel("tok:latest"); } catch {}
  return noStoreJson({ ok: true, purged: "tok:latest" });
}
