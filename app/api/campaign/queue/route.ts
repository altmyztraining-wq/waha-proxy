import { NextResponse } from "next/server";
import { prisma, logActivity } from "@/app/lib/db";

export const runtime = "nodejs";

async function recordActivity(input: Parameters<typeof logActivity>[0]) {
  try {
    await logActivity(input);
  } catch (error) {
    console.error("[AUDIT] Unable to persist queue activity.", error);
  }
}

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

    const stuckBefore = Date.now() - 2 * 60 * 1000;
    const jobsWithDisplayStatus = jobs.map((job) => ({
      ...job,
      displayStatus:
        job.status === "PROCESSING" && job.updatedAt.getTime() < stuckBefore
          ? "STUCK"
          : job.status,
    }));

    return NextResponse.json({ campaignName, jobs: jobsWithDisplayStatus });
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
    await recordActivity({
      source: "CAMPAIGN",
      event: "CAMPAIGN_QUEUED",
      status: "SUCCESS",
      message: `Queued ${result.count} jobs for campaign "${finalCampaignName}".`,
      metadata: { campaignName: finalCampaignName, queuedCount: result.count },
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
    const action = typeof body.action === "string" ? body.action : "retry_failed";

    if (!campaignName) {
      return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
    }

    if (action === "recover_stuck") {
      const stuckBefore = new Date(Date.now() - 2 * 60 * 1000);
      const result = await prisma.campaignQueue.updateMany({
        where: {
          campaignName,
          status: "PROCESSING",
          updatedAt: { lt: stuckBefore },
        },
        data: {
          status: "PENDING",
          errorReason: null,
        },
      });
      await recordActivity({
        source: "CAMPAIGN",
        event: "STUCK_JOBS_RECOVERED",
        status: "WARNING",
        message: `Recovered ${result.count} stuck jobs for "${campaignName}".`,
        metadata: { campaignName, recoveredCount: result.count },
      });

      return NextResponse.json({ success: true, recoveredCount: result.count });
    }

    if (action !== "retry_failed") {
      return NextResponse.json({ error: "Unsupported recovery action." }, { status: 400 });
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
    await recordActivity({
      source: "CAMPAIGN",
      event: "FAILED_JOBS_RETRIED",
      status: "INFO",
      message: `Moved ${result.count} failed jobs back to pending for "${campaignName}".`,
      metadata: { campaignName, retriedCount: result.count },
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
    await recordActivity({
      source: "CAMPAIGN",
      event: "PENDING_JOBS_REMOVED",
      status: "WARNING",
      message: `Removed ${result.count} pending campaign jobs${campaignName ? ` from "${campaignName}"` : " globally"}.`,
      metadata: { campaignName: campaignName ?? "all", deletedCount: result.count },
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
