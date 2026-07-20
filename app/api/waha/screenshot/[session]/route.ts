import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getWahaBaseUrl() {
  return process.env.WAHA_API_URL ?? "http://localhost:3000";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ session: string }> }
) {
  const { session } = await context.params;
  const apiKey = process.env.WAHA_API_KEY ?? "";
  const headers: Record<string, string> = {};

  if (apiKey) headers["X-Api-Key"] = apiKey;

  const response = await fetch(
    `${getWahaBaseUrl()}/api/screenshot?session=${encodeURIComponent(session)}`,
    { headers, cache: "no-store" }
  );

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Unable to capture the WAHA session screen.",
        details: await response.text(),
      },
      { status: response.status }
    );
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
