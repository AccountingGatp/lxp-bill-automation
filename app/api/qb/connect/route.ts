import { NextResponse } from "next/server";
import { authorizeUrl, MOCK, mockConnect } from "@/lib/qb";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (MOCK) {
    await mockConnect();
    return NextResponse.redirect(new URL("/", req.url));
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("qb_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
