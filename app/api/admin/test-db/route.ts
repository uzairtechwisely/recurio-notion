// app/api/admin/test-db/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { notionClient } from "../../_utils";
import { adoptTokenForThisSession } from "../../_session";

export async function GET(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ ok: false, error: "missing_db_param" }, 400);

  try {
    const meta = await notion.databases.retrieve({ database_id: dbId }).catch((e: any) => ({ _err: e?.message || String(e) }));
    let queryOk = true, queryErr = null;
    try {
      await notion.databases.query({ database_id: dbId, page_size: 1 });
    } catch (e: any) {
      queryOk = false; queryErr = e?.message || String(e);
    }
    return noStoreJson({ ok: true, retrieveOk: !meta?._err, retrieveErr: meta?._err || null, queryOk, queryErr });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || "probe_failed" }, 500);
  }
}
