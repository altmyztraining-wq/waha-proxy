import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // WAHA usually sends the event type in the body payload
    // Examples: "message", "message.any", "session.status"
    const event = payload?.event;
    const session = payload?.session;

    console.log(`\n[WEBHOOK RECEIVED] Event: ${event} | Session: ${session}`);
    
    if (event === "message" || event === "message.any") {
      const msg = payload?.payload;
      console.log(` - From: ${msg?.from}`);
      console.log(` - Body: ${msg?.body}`);
    } else if (event === "session.status") {
      console.log(` - Status Update: ${payload?.payload?.status}`);
    } else {
      console.log(` - Payload: ${JSON.stringify(payload?.payload)}`);
    }
    console.log("--------------------------------------------------\n");

    return NextResponse.json({ success: true, received: true });
  } catch (error) {
    console.error("[WEBHOOK ERROR] Failed to process webhook", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
