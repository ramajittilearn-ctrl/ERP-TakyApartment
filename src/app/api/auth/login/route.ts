import { cookies } from "next/headers";
import { COOKIE, SESSION_SECONDS, login } from "@/server/auth";
import { checkOrigin, handle, json, readJson } from "@/server/http";
export function POST(request: Request) {
  return handle(async () => {
    const origin = checkOrigin(request);
    const session = await login(await readJson(request));
    (await cookies()).set(COOKIE, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure:
        origin.protocol === "https:" || process.env.COOKIE_SECURE === "true",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return json({ authenticated: true });
  });
}
