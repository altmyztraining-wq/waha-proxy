import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getWahaBaseUrl() {
  return process.env.WAHA_API_URL ?? "http://localhost:3000";
}

function getWahaApiKey() {
  return process.env.WAHA_API_KEY ?? "";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ session: string }> }
) {
  const { session } = await context.params;
  const headers: Record<string, string> = {};
  const apiKey = getWahaApiKey();

  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  const response = await fetch(
    `${getWahaBaseUrl()}/api/${encodeURIComponent(session)}/auth/qr`,
    {
      headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const message = await response.text();

    return NextResponse.json(
      {
        error: "Unable to load QR code from WAHA.",
        details: message,
      },
      { status: response.status }
    );
  }

  const image = await response.arrayBuffer();

  return new Response(image, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "no-store",
    },
  });
}
