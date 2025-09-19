import { cookies, headers } from "next/headers";

export async function getSidFromRequest(): Promise<string | null> {
  const h = await headers();
  const c = await cookies();
  const sidFromHeader = h.get("x-recurio-sid");
  const sidFromCookie = c.get("recurio_sid")?.value;
  return sidFromHeader || sidFromCookie || null;
}
