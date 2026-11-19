import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

// Endpoints that authenticate themselves (QStash signature, cron secret or signed email link).
// Telegram webhook checks its secret header; push actions carry a signed token.
const PUBLIC = ["/login", "/api/auth/login", "/api/deliver", "/api/action", "/api/cron", "/api/sweep", "/api/telegram/webhook", "/api/push/action"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon.*|.*\\.png$|.*\\.svg$).*)"],
};
