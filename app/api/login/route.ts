import { NextResponse } from "next/server";
import { COOKIE, makeSession } from "@/lib/session";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const expected = process.env.APP_PASSWORD;
  if (!expected) return NextResponse.json({ error: "APP_PASSWORD is not set on the server." }, { status: 500 });
  if (password !== expected) return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  const s = await makeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: s.maxAge, path: "/" });
  return res;
}
