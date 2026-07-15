import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const counts = await prisma.campaignQueue.groupBy({
      by: ["status"],
      _count: {
        _all: true,
      },
    });

    const metrics = {
      PENDING: 0,
      PROCESSING: 0,
      DONE: 0,
      FAILED: 0,
      TOTAL: 0,
    };

    for (const row of counts) {
      const status = row.status as keyof typeof metrics;
      if (metrics[status] !== undefined) {
        metrics[status] = row._count._all;
        metrics.TOTAL += row._count._all;
      }
    }

    return NextResponse.json(metrics);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch queue status." }, { status: 500 });
  }
}
