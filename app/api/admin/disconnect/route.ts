import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { redisGet, redisDel } from "../../_utils";

export async function POST() {
  const store = await getCookies();
  const sid = store.get("sid")?.value;
  if (!sid) return NextResponse.json({ ok: true, note: "no sid" });

  const tokSid = await redisGet<any>(`tok:${sid}`);
  const tokLatest = await redisGet<any>("tok:latest");

  await redisDel(`tok:${sid}`);
  // If this session owned tok:latest, clear it too to avoid accidental reuse
  if (tokSid && tokLatest && tokSid?.access_token === tokLatest?.access_token) {
    await redisDel("tok:latest");
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: "sid", value: "", path: "/", maxAge: 0 });
  return res;
}
