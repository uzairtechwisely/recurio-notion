import { cookies, headers } from "next/headers";

export async function getSidFromRequest(): Promise<string | null> {
  const h = headers();
  const sidFromHeader = h.get("x-recurio-sid");
  const sidFromCookie = cookies().get("recurio_sid")?.value;
  return sidFromHeader || sidFromCookie || null;
}
