import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const campaignName = url.searchParams.get("campaignName")?.trim();

    if (!campaignName) {
      return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
    }

    const jobs = await prisma.campaignQueue.findMany({
      where: { campaignName },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        targetPhone: true,
        messageBody: true,
        status: true,
        errorReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ campaignName, jobs });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to load campaign details.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetPhones, messageBody, campaignName } = body;

    if (!targetPhones || !messageBody) {
      return NextResponse.json(
        { error: "Missing targets or message template." },
        { status: 400 }
      );
    }

    const phones: string[] = Array.from(new Set(targetPhones.split(/[\n,; ]+/).map((p: string) => p.trim()).filter(Boolean)));

    if (phones.length === 0) {
      return NextResponse.json({ error: "No valid phones provided." }, { status: 400 });
    }

    const finalCampaignName = campaignName?.trim() || `Campaign - ${new Date().toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }).replace(",", "")}`;

    const creates = phones.map((phone) => ({
      campaignName: finalCampaignName,
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

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const campaignName = typeof body.campaignName === "string" ? body.campaignName.trim() : "";

    if (!campaignName) {
      return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
    }

    const result = await prisma.campaignQueue.updateMany({
      where: {
        campaignName,
        status: "FAILED",
      },
      data: {
        status: "PENDING",
        errorReason: null,
      },
    });

    return NextResponse.json({
      success: true,
      retriedCount: result.count,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to retry campaign jobs.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const campaignName = url.searchParams.get("campaignName");

    const result = await prisma.campaignQueue.deleteMany({
      where: {
        status: "PENDING",
        ...(campaignName ? { campaignName } : {}),
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
