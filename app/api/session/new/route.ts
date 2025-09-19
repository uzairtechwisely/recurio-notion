// app/api/session/new/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";
export const fetchCache = "force-no-store";

export async function POST() {
  const sid = crypto.randomUUID();

  const res = NextResponse.json({ ok: true, sid });
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.cookies.set({
    name: "recurio_sid",
    value: sid,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return res;
}