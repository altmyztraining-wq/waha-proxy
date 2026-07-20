import { NextResponse } from "next/server";
import {
  getMessageStats,
  getRecentMessageLogs,
  getSenderStats,
  listSenders,
  getSenderAnalytics,
  syncSendersWithWahaSessions,
  getRecentActivityLogs,
} from "@/app/lib/db";
import { getWahaVersion, listWahaSessions, WahaError } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getConfiguredProxyUrl() {
  return process.env.WAHA_SESSION_PROXY_URL ?? "";
}

export async function GET() {
  try {
    const [
      messageLogs,
      messageStats,
      activityLogs,
      wahaVersion,
      wahaSessions,
    ] = await Promise.all([
      getRecentMessageLogs(50),
      getMessageStats(),
      getRecentActivityLogs(100),
      getWahaVersion(),
      listWahaSessions(),
    ]);

    // Sync first so this very response never contains stale ACTIVE senders.
    if (Array.isArray(wahaSessions)) {
      await syncSendersWithWahaSessions(wahaSessions);
    }

    const [senders, senderStats] = await Promise.all([listSenders(), getSenderStats()]);

    // Attach analytics to each sender
    const sendersWithAnalytics = await Promise.all(
      senders.map(async (sender) => {
        const analytics = await getSenderAnalytics(sender.phoneNumber);
        return { ...sender, analytics };
      })
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      configuredProxyUrl: getConfiguredProxyUrl(),
      waha: {
        version: wahaVersion,
        sessions: wahaSessions,
      },
      senders: sendersWithAnalytics,
      messageLogs,
      activityLogs,
      stats: {
        messages: messageStats,
        senders: senderStats,
      },
    });
  } catch (error: unknown) {
    console.error("[MONITOR] Unable to load monitoring data.", error);

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
      { error: "Unable to load monitoring data." },
      { status: 500 }
    );
  }
}
