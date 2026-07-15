import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber, status } = body;

    if (!phoneNumber || !status) {
      return NextResponse.json(
        { error: "Phone number and status are required." },
        { status: 400 }
      );
    }

    if (!["ACTIVE", "RESTING", "BANNED"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status." },
        { status: 400 }
      );
    }

    const updated = await prisma.wahaSender.update({
      where: { phoneNumber: phoneNumber.replace(/\D/g, "") },
      data: { status },
    });

    return NextResponse.json({ success: true, sender: updated });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update sender status." },
      { status: 500 }
    );
  }
}
