// Minimal HTTP helpers for API routes

export function noStoreJson(
  data: unknown,
  init: ResponseInit = {}
): Response {
  const h = new Headers(init.headers);
  // never cache auth endpoints
  h.set("Cache-Control", "no-store, must-revalidate");
  // useful for iframe embedding (tighten later if needed)
  h.set(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://www.notion.so https://*.notion.so https://*.notion.site"
  );
  return Response.json(data, { ...init, headers: h });
}

export function badRequest(msg: string, extra?: Record<string, unknown>) {
  return noStoreJson({ ok: false, error: msg, ...extra }, { status: 400 });
}

export function unauthorized(msg = "unauthorized") {
  return noStoreJson({ ok: false, error: msg }, { status: 401 });
}