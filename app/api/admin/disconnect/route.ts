export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import { redisGet, redisDel } from "../../_utils";

export async function POST() {
  const sid = (await getCookies()).get("sid")?.value;
  if (!sid) return noStoreJson({ ok: true, note: "no sid" });

  const tokSid = await redisGet<any>(`tok:${sid}`);
  const tokLatest = await redisGet<any>("tok:latest");

  await redisDel(`tok:${sid}`);
  if (tokSid && tokLatest && tokSid?.access_token === tokLatest?.access_token) {
    await redisDel("tok:latest");
  }

  const res = noStoreJson({ ok: true });
  res.cookies.set({ name: "sid", value: "", path: "/", maxAge: 0 });
  return res;
}
