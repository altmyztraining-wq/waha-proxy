import { NextResponse } from "next/server";
import { createWahaSession, WahaError } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StartSessionRequest = {
  sessionName?: string;
  proxyUrl?: string;
  start?: boolean;
};

function getConfiguredProxyUrl(bodyProxyUrl?: string) {
  // Allow per-session proxy override — each phone needs its own proxy
  if (bodyProxyUrl?.trim()) {
    return bodyProxyUrl.trim();
  }

  const envProxyUrl = process.env.WAHA_SESSION_PROXY_URL?.trim();
  if (!envProxyUrl) {
    throw new WahaError(
      "WAHA_SESSION_PROXY_URL is not configured on the server.",
      500
    );
  }

  return envProxyUrl;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StartSessionRequest;
    const sessionName = body.sessionName?.trim();

    if (!sessionName) {
      return NextResponse.json(
        { error: "Session name is required." },
        { status: 400 }
      );
    }

    const data = await createWahaSession({
      sessionName,
      proxyUrl: getConfiguredProxyUrl(body.proxyUrl),
      start: body.start ?? true,
    });

    return NextResponse.json({
      success: true,
      sessionName,
      proxyExitIp: data.proxyExitIp,
      data,
    });
  } catch (error: unknown) {
    if (error instanceof WahaError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
