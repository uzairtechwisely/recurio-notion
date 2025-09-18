import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redisGet } from "../_utils";

export async function GET() {
  const sid = cookies().get("sid")?.value;
  if (!sid) return NextResponse.json({ connected: false });
  const tok = await redisGet(`tok:${sid}`);
  return NextResponse.json({ connected: !!tok?.access_token });
}
