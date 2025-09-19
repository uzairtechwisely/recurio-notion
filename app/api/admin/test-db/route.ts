// app/api/admin/test-db/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { notionClient } from "../../_utils";
import { getTokenFromRequest } from "../../_session";

export async function GET(req: Request) {
  const tok = await getTokenFromRequest<any>();
if (!tok?.access_token) return noStoreJson({ ok: false, error: "no_token" }, 401);
const notion = notionClient(tok.access_token);

  const u = new URL(req.url);
  const dbId = u.searchParams.get("db");
  if (!dbId) return noStoreJson({ ok: false, error: "missing_db_param" }, 400);

  let retrieveOk = false;
  let retrieveErr: string | null = null;
  let queryOk = false;
  let queryErr: string | null = null;

  try {
    await notion.databases.retrieve({ database_id: dbId });
    retrieveOk = true;
  } catch (e: any) {
    retrieveErr = e?.message || String(e);
  }

  if (retrieveOk) {
    try {
      await notion.databases.query({ database_id: dbId, page_size: 1 });
      queryOk = true;
    } catch (e: any) {
      queryErr = e?.message || String(e);
    }
  }

  return noStoreJson({
    ok: true,
    retrieveOk,
    retrieveErr,
    queryOk,
    queryErr,
  });
}
