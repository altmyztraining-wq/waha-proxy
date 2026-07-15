import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetPhones, messageBody } = body;

    if (!targetPhones || !messageBody) {
      return NextResponse.json(
        { error: "Missing targets or message template." },
        { status: 400 }
      );
    }

    const phones = Array.from(new Set(targetPhones.split(/[\n,; ]+/).map((p: string) => p.trim()).filter(Boolean)));

    if (phones.length === 0) {
      return NextResponse.json({ error: "No valid phones provided." }, { status: 400 });
    }

    const creates = phones.map((phone: string) => ({
      targetPhone: phone,
      messageBody,
      status: "PENDING",
    }));

    const result = await prisma.campaignQueue.createMany({
      data: creates,
    });

    return NextResponse.json({
      success: true,
      queuedCount: result.count,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to queue campaign.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const result = await prisma.campaignQueue.deleteMany({
      where: {
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to reset pending queue.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

