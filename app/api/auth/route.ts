import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const correctPassword = process.env.DASHBOARD_PASSWORD;

    if (!correctPassword) {
      // If no password is configured, allow access
      return NextResponse.json({ success: true });
    }

    if (password === correctPassword) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }
}
