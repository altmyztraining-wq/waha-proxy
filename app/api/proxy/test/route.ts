import { NextResponse } from "next/server";
import { parseWahaProxyUrl, verifyProxyFromDocker, WahaError } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProxyTestRequest = {
  proxyUrl?: string;
};

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as ProxyTestRequest;
    const proxyUrl = body.proxyUrl?.trim() || process.env.WAHA_SESSION_PROXY_URL?.trim() || "";

    if (!proxyUrl) {
      return NextResponse.json({ error: "Proxy URL is required." }, { status: 400 });
    }

    const parsed = parseWahaProxyUrl(proxyUrl);
    const result = await verifyProxyFromDocker(proxyUrl);

    return NextResponse.json({
      success: true,
      proxyServer: parsed.server,
      exitIp: result.ip,
      whatsappReachable: true,
      durationMs: Date.now() - startedAt,
      testedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof WahaError) {
      return NextResponse.json(
        { error: error.message, durationMs: Date.now() - startedAt },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Proxy test failed.", durationMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
