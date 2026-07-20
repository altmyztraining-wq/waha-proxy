import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, logActivity } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTO_REPLY_MESSAGES = [
  "تم استلام رسالتك، وسيتم الرد على حضرتك في أقرب وقت ممكن.",
  "شكرًا لتواصلك معنا. تم تسجيل رسالتك وسنرد على حضرتك في أقرب وقت.",
  "وصلتنا رسالتك بنجاح، وسيقوم أحد المسؤولين بالرد على حضرتك قريبًا.",
];

function phoneFromChatId(value: unknown) {
  if (typeof value !== "string" || !value.endsWith("@c.us")) return null;
  const phone = value.split("@")[0].replace(/\D/g, "");
  return phone || null;
}

function messageId(message: Record<string, any>) {
  const value = message.id;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return value._serialized ?? value.id ?? null;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // WAHA usually sends the event type in the body payload
    // Examples: "message", "message.any", "session.status"
    const event = payload?.event;
    const session = payload?.session;

    console.log(`\n[WEBHOOK RECEIVED] Event: ${event} | Session: ${session}`);
    
    if (event === "message" || event === "message.any") {
      const msg = payload?.payload;
      console.log(` - From: ${msg?.from}`);
      console.log(` - Body: ${msg?.body}`);

      const fromMe = Boolean(msg?.fromMe ?? msg?.id?.fromMe);
      const targetPhone = phoneFromChatId(msg?.from ?? msg?.chatId);
      const sourceMessageId = messageId(msg ?? {});
      const sessionName = typeof session === "string" ? session : session?.name;

      if (!fromMe && targetPhone && sourceMessageId && sessionName) {
        const latestSystemEvent = await prisma.activityLog.findFirst({
          where: {
            source: "SYSTEM",
            event: { in: ["UNIFIED_AUTOPILOT_STARTED", "UNIFIED_AUTOPILOT_STOPPED"] },
          },
          orderBy: { createdAt: "desc" },
        });
        const rawTimestamp = Number(msg?.timestamp ?? msg?.t ?? 0);
        const messageDate = rawTimestamp > 0
          ? new Date(rawTimestamp > 10_000_000_000 ? rawTimestamp : rawTimestamp * 1000)
          : null;
        const systemIsRunning = latestSystemEvent?.event === "UNIFIED_AUTOPILOT_STARTED";
        const arrivedDuringThisRun = Boolean(
          messageDate && latestSystemEvent && messageDate >= latestSystemEvent.createdAt
        );

        if (!systemIsRunning || !arrivedDuringThisRun) {
          return NextResponse.json({ success: true, received: true, autoReply: "ignored_not_live" });
        }

        const internalSender = await prisma.wahaSender.findUnique({
          where: { phoneNumber: targetPhone },
          select: { phoneNumber: true },
        });

        if (!internalSender) {
          const recentAcknowledgement = await prisma.campaignQueue.findFirst({
            where: {
              jobType: "AUTO_REPLY",
              sessionName,
              targetPhone,
              status: { in: ["PENDING", "PROCESSING", "DONE"] },
              createdAt: { gte: latestSystemEvent!.createdAt },
            },
            select: { id: true },
          });
          if (recentAcknowledgement) {
            return NextResponse.json({ success: true, received: true, autoReply: "already_replied_this_run" });
          }

          const minDelaySeconds = Math.max(10, Number(process.env.AUTO_REPLY_MIN_DELAY_SECONDS ?? 35));
          const maxDelaySeconds = Math.max(minDelaySeconds, Number(process.env.AUTO_REPLY_MAX_DELAY_SECONDS ?? 120));
          const delaySeconds = Math.floor(Math.random() * (maxDelaySeconds - minDelaySeconds + 1)) + minDelaySeconds;
          const reply = AUTO_REPLY_MESSAGES[Math.floor(Math.random() * AUTO_REPLY_MESSAGES.length)];

          try {
            const job = await prisma.campaignQueue.create({
              data: {
                campaignName: "Customer Auto Replies",
                jobType: "AUTO_REPLY",
                sessionName,
                sourceMessageId,
                targetPhone,
                messageBody: reply,
                scheduledAt: new Date(Date.now() + delaySeconds * 1000),
              },
            });
            await logActivity({
              source: "AUTO_REPLY",
              event: "REPLY_QUEUED",
              status: "INFO",
              message: `Acknowledgement queued for ${targetPhone}.`,
              metadata: { jobId: job.id, sessionName, targetPhone, delaySeconds, sourceMessageId },
            });
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
          }
        }
      }
    } else if (event === "session.status") {
      console.log(` - Status Update: ${payload?.payload?.status}`);
    } else {
      console.log(` - Payload: ${JSON.stringify(payload?.payload)}`);
    }
    console.log("--------------------------------------------------\n");

    return NextResponse.json({ success: true, received: true });
  } catch (error) {
    console.error("[WEBHOOK ERROR] Failed to process webhook", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
