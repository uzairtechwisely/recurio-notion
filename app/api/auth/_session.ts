import { headers, cookies } from "next/headers";

/**
 * Looks for SID in header `x-recurio-sid` first, then cookie `recurio_sid`.
 * Using `await` works whether these helpers are sync or async in your runtime.
 */
export async function getSidFromRequest(): Promise<string | null> {
  const h = await headers();
  const sidFromHeader = h.get("x-recurio-sid");
  const sidFromCookie = (await cookies()).get("recurio_sid")?.value;
  return sidFromHeader ?? sidFromCookie ?? null;
}