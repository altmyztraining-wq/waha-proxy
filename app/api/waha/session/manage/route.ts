import { NextResponse } from "next/server";
import { manageWahaSession, WahaError } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { sessionName, action } = await request.json();

    if (!sessionName || !action) {
      return NextResponse.json(
        { error: "sessionName and action are required." },
        { status: 400 }
      );
    }

    if (!["start", "stop", "logout", "force_delete"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use start, stop, logout, or force_delete." },
        { status: 400 }
      );
    }

    if (action === "force_delete") {
      try {
        await manageWahaSession(sessionName, "stop");
      } catch (e) {
        // Ignore stop errors, it might already be stopped or stuck
      }
      // Wait a moment for it to stop
      await new Promise(res => setTimeout(res, 1500));
      await manageWahaSession(sessionName, "logout");
    } else {
      await manageWahaSession(sessionName, action as any);
    }

    return NextResponse.json({ success: true, sessionName, action });
  } catch (error: unknown) {
    if (error instanceof WahaError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Failed to manage session." },
      { status: 500 }
    );
  }
}
