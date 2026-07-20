import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [counts, processingJob, pendingJob] = await Promise.all([
      prisma.campaignQueue.groupBy({
        by: ["campaignName", "status"],
        _count: { _all: true },
      }),
      prisma.campaignQueue.findFirst({
        where: { status: "PROCESSING" },
        orderBy: { updatedAt: "asc" },
        select: { campaignName: true, status: true },
      }),
      prisma.campaignQueue.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { campaignName: true, status: true },
      }),
    ]);

    const campaignsMap: Record<string, { PENDING: number, PROCESSING: number, DONE: number, FAILED: number, TOTAL: number }> = {};
    
    const globalMetrics = {
      PENDING: 0,
      PROCESSING: 0,
      DONE: 0,
      FAILED: 0,
      TOTAL: 0,
    };

    for (const row of counts) {
      const { campaignName, status } = row;
      const count = row._count._all;

      if (!campaignsMap[campaignName]) {
        campaignsMap[campaignName] = {
          PENDING: 0,
          PROCESSING: 0,
          DONE: 0,
          FAILED: 0,
          TOTAL: 0,
        };
      }

      const campaignMetrics = campaignsMap[campaignName];
      const statKey = status as keyof typeof globalMetrics;

      if (campaignMetrics[statKey] !== undefined) {
        campaignMetrics[statKey] = count;
        campaignMetrics.TOTAL += count;
      }

      if (globalMetrics[statKey] !== undefined) {
        globalMetrics[statKey] += count;
        globalMetrics.TOTAL += count;
      }
    }

    const campaignsList = Object.entries(campaignsMap).map(([name, metrics]) => ({
      name,
      ...metrics,
    }));

    return NextResponse.json({
      global: globalMetrics,
      campaigns: campaignsList,
      activeCampaign: processingJob ?? pendingJob ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch queue status." }, { status: 500 });
  }
}
