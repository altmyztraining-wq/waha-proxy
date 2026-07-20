import { NextResponse } from "next/server";
import { logActivity } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "UNIFIED_AUTOPILOT_STARTED",
  "UNIFIED_AUTOPILOT_STOPPED",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { event?: string };
    const event = body.event ?? "";

    if (!ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: "Unsupported activity event." }, { status: 400 });
    }

    await logActivity({
      source: "SYSTEM",
      event,
      status: "INFO",
      message: event === "UNIFIED_AUTOPILOT_STARTED"
        ? "Unified Auto-Pilot started both campaign and AI engines."
        : "Unified Auto-Pilot stopped both campaign and AI engines.",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record activity." },
      { status: 500 }
    );
  }
}
