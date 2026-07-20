import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SESSION_COOKIE = "waha_dashboard_session";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const correctPassword = process.env.DASHBOARD_PASSWORD;

    const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

    if (!correctPassword || !sessionSecret) {
      return NextResponse.json(
        { error: "Dashboard authentication is not configured." },
        { status: 503 }
      );
    }

    if (password === correctPassword) {
      const response = NextResponse.json({ success: true });
      response.cookies.set(SESSION_COOKIE, sessionSecret, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
      return response;
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

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
