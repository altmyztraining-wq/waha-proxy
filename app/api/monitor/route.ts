import { NextResponse } from "next/server";
import {
  getMessageStats,
  getRecentMessageLogs,
  getSenderStats,
  listSenders,
  getSenderAnalytics,
  upsertSender,
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
      senders,
      messageLogs,
      messageStats,
      senderStats,
      wahaVersion,
      wahaSessions,
    ] = await Promise.all([
      listSenders(),
      getRecentMessageLogs(50),
      getMessageStats(),
      getSenderStats(),
      getWahaVersion(),
      listWahaSessions(),
    ]);

    // Auto-Sync WORKING sessions directly into our DB
    if (Array.isArray(wahaSessions)) {
      for (const session of wahaSessions) {
        if (session.status === "WORKING" && session.me?.id && session.name) {
          const phone = session.me.id.split("@")[0];
          const proxyIp = session.config?.proxy?.server ?? "";
          
          // Only register if it looks like a valid phone
          if (/^\d{8,15}$/.test(phone)) {
            // Upsert in background without awaiting all of them to block the monitor request
            void upsertSender({
              phoneNumber: phone,
              sessionName: session.name,
              status: "ACTIVE",
              maxDailyLimit: 50,
              proxyIp,
            }).catch(() => { /* ignore sync errors on monitor */ });
          }
        }
      }
    }

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
      stats: {
        messages: messageStats,
        senders: senderStats,
      },
    });
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
      { error: "Unable to load monitoring data." },
      { status: 500 }
    );
  }
}
