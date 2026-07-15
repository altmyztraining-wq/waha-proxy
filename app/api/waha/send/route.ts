import { NextResponse } from "next/server";
import { sendWahaText, WahaError } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendTextRequest = {
  sessionName?: string;
  phoneNumber?: string;
  message?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendTextRequest;
    const sessionName = body.sessionName?.trim();
    const phoneNumber = body.phoneNumber?.trim();
    const message = body.message?.trim();

    if (!sessionName || !phoneNumber || !message) {
      return NextResponse.json(
        { error: "Session name, phone number, and message are all required." },
        { status: 400 }
      );
    }

    const data = await sendWahaText({
      sessionName,
      phoneNumber,
      message,
    });

    return NextResponse.json({ success: true, data });
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
