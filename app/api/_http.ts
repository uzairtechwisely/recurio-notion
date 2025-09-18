import { NextResponse } from "next/server";

/** JSON response with hard no-store headers (safe for multi-user). */
export function noStoreJson(data: any, init: number | ResponseInit = 200) {
  const res = NextResponse.json(
    data,
    typeof init === "number" ? { status: init } : init
  );
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

/** Redirect response with hard no-store headers. */
export function noStoreRedirect(url: string, init?: number | ResponseInit) {
  const res = NextResponse.redirect(url, init as any);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
