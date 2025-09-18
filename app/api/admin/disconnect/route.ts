// app/api/admin/disconnect/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../../_http";
import { redisDel } from "../../_utils";
import { adoptTokenForThisSession } from "../../_session";

export async function POST() {
  const { sid } = await adoptTokenForThisSession();
  if (!sid) return noStoreJson({ ok: true, note: "no sid" });

  try { if (typeof redisDel === "function") await redisDel(`tok:${sid}`); } catch {}

  const res = noStoreJson({ ok: true, cleared: [`tok:${sid}`] });
  res.cookies.set({ name: "oauth_state", value: "", path: "/", maxAge: 0 });
  return res;
}
