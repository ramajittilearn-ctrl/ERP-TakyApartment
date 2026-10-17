import { cookies } from "next/headers";
import { COOKIE, logout } from "@/server/auth";
import { checkOrigin, handle, json } from "@/server/http";
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const jar = await cookies();
    await logout(jar.get(COOKIE)?.value);
    jar.set(COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: 0,
    });
    return json({ authenticated: false });
  });
}
