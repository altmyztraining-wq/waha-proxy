import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "waha_dashboard_session";

function isFrontendGateway() {
  return process.env.DEPLOYMENT_MODE === "frontend";
}

function hasDashboardSession(request: NextRequest) {
  const expected = process.env.DASHBOARD_SESSION_SECRET;
  return Boolean(expected && request.cookies.get(SESSION_COOKIE)?.value === expected);
}

function isLocalBackendRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "host.docker.internal" ||
    hostname === "[::1]"
  );
}

function cameThroughPublicTunnel(request: NextRequest) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  const forwardedHostIsPublic = Boolean(
    forwardedHost &&
      !["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal", "[::1]"].includes(
        forwardedHost
      )
  );

  return (
    request.headers.has("cf-connecting-ip") ||
    request.headers.has("cf-ray") ||
    forwardedHostIsPublic
  );
}

function unauthorizedApi() {
  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isFrontendGateway()) {
    if (pathname === "/login" || pathname === "/api/auth") {
      if (pathname === "/login" && hasDashboardSession(request)) {
        return NextResponse.redirect(new URL("/", request.url));
      }
      return NextResponse.next();
    }

    if (!hasDashboardSession(request)) {
      if (pathname.startsWith("/api/")) return unauthorizedApi();
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (pathname.startsWith("/api/")) {
      const gatewayUrl = process.env.FRONTEND_GATEWAY_URL;
      const gatewaySecret = process.env.GATEWAY_SHARED_SECRET;
      if (!gatewayUrl || !gatewaySecret) {
        return NextResponse.json(
          { error: "Frontend gateway is not configured." },
          { status: 503 }
        );
      }

      const target = new URL(`${pathname}${request.nextUrl.search}`, gatewayUrl);
      const headers = new Headers(request.headers);
      headers.set("x-waha-gateway-secret", gatewaySecret);
      headers.set("ngrok-skip-browser-warning", "true");
      headers.delete("cookie");

      return NextResponse.rewrite(target, { request: { headers } });
    }

    return NextResponse.next();
  }

  if (cameThroughPublicTunnel(request) || !isLocalBackendRequest(request)) {
    if (!pathname.startsWith("/api/")) {
      return new NextResponse("Not found", { status: 404 });
    }

    const expected = process.env.GATEWAY_SHARED_SECRET;
    const supplied = request.headers.get("x-waha-gateway-secret");
    if (!expected || supplied !== expected) return unauthorizedApi();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
