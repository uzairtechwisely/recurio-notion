// app/api/_session.ts
import { cookies as getCookies } from "next/headers";
import { redisGet, redisSet } from "./_utils";

export async function adoptTokenForThisSession() {
  const jar = await getCookies();
  let sid = jar.get("sid")?.value || null;

  const tokBySid = sid ? await redisGet<any>(`tok:${sid}`) : null;
  const tokLatest = await redisGet<any>("tok:latest");

  let source: "sid" | "adopted-latest" | "none" = "none";
  let tok = tokBySid;

  if (tokBySid?.access_token) {
    source = "sid";
  } else if (tokLatest?.access_token) {
    if (!sid) {
      sid = Math.random().toString(36).slice(2);
    }
    await redisSet(`tok:${sid}`, tokLatest);
    tok = tokLatest;
    source = "adopted-latest";
  }

  return { sid, tok, source };
}
