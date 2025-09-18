// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // Let Notion embed your dashboard (and block random sites)
  res.headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://www.notion.so https://*.notion.so https://*.notion.site"
  );

  return res;
}

export const config = { matcher: ["/:path*"] };
