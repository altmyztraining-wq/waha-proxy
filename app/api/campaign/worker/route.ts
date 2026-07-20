import { NextResponse } from "next/server";
import { prisma, getNextRoundRobinSender, logMessageResult, logActivity, lockSender, unlockSender } from "@/app/lib/db";
import { sendWahaText, setWahaPresence, setWahaSeen, checkProxyHealth, WahaError, calculateTypingTime, listWahaSessions } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSpintax(text: string) {
  return text.replace(/\{([^{}]+)\}/g, (_, options) => {
    const opts = options.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

function errorToReason(error: unknown) {
  if (error instanceof WahaError) return error.message;
  return error instanceof Error ? error.message : "Unexpected send failure.";
}

async function recordActivity(input: Parameters<typeof logActivity>[0]) {
  try {
    await logActivity(input);
  } catch (error) {
    console.error("[AUDIT] Unable to persist campaign activity.", error);
  }
}

export async function POST() {
  try {
    const sessions = await listWahaSessions();
    const liveSenderIdentities = sessions
      .filter((session) => session.status === "WORKING" && session.name && session.me?.id)
      .map((session) => ({
        sessionName: session.name as string,
        phoneNumber: session.me!.id!.split("@")[0],
      }));

    // 1. Find ONE pending job
    const job = await prisma.campaignQueue.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });

    if (!job) {
      return NextResponse.json({ message: "Queue is empty." });
    }

    // 2. Mark as processing
    await prisma.campaignQueue.update({
      where: { id: job.id },
      data: { status: "PROCESSING" },
    });
    await recordActivity({
      source: "CAMPAIGN",
      event: "JOB_CLAIMED",
      status: "INFO",
      message: `Campaign job ${job.id} is processing.`,
      metadata: { jobId: job.id, campaignName: job.campaignName, targetPhone: job.targetPhone },
    });

    // 3. Find available sender
    const sender = await getNextRoundRobinSender(undefined, liveSenderIdentities);
    if (!sender) {
      // Revert to pending so it can be retried later
      await prisma.campaignQueue.update({
        where: { id: job.id },
        data: { status: "PENDING" },
      });
      await recordActivity({
        source: "CAMPAIGN",
        event: "JOB_REQUEUED",
        status: "WARNING",
        message: `Campaign job ${job.id} was re-queued because no sender was available.`,
        metadata: { jobId: job.id, campaignName: job.campaignName, targetPhone: job.targetPhone },
      });
      return NextResponse.json({ error: "No available senders. Re-queued." }, { status: 400 });
    }

    const finalMessageBody = parseSpintax(job.messageBody);

    lockSender(sender.phoneNumber);
    await recordActivity({
      source: "CAMPAIGN",
      event: "SENDER_SELECTED",
      status: "INFO",
      message: `${sender.phoneNumber} selected for campaign job ${job.id}.`,
      metadata: { jobId: job.id, campaignName: job.campaignName, senderPhone: sender.phoneNumber, targetPhone: job.targetPhone, proxyIp: sender.proxyIp },
    });

    try {
      // Proxy Health Check
      const isProxyHealthy = await checkProxyHealth(sender.proxyIp);
      if (!isProxyHealthy) {
        throw new Error(`Proxy ${sender.proxyIp} is down.`);
      }

      // Human Delays (Typing Simulation)
      await setWahaSeen({ sessionName: sender.sessionName, phoneNumber: job.targetPhone });
      await sleep(Math.floor(Math.random() * 1000) + 500);

      await setWahaPresence({
        sessionName: sender.sessionName,
        phoneNumber: job.targetPhone,
        presence: "typing",
      });

      const typeTimeMs = calculateTypingTime(finalMessageBody);
      await sleep(typeTimeMs);

      await setWahaPresence({
        sessionName: sender.sessionName,
        phoneNumber: job.targetPhone,
        presence: "paused",
      });
      await sleep(Math.floor(Math.random() * 500) + 200);

      // Send Message
      await sendWahaText({
        sessionName: sender.sessionName,
        phoneNumber: job.targetPhone,
        message: finalMessageBody,
      });

      // Log success
      await logMessageResult(sender.phoneNumber, job.targetPhone, finalMessageBody, "SENT");

      // Mark Job Done
      await prisma.campaignQueue.update({
        where: { id: job.id },
        data: { status: "DONE" },
      });
      await recordActivity({
        source: "CAMPAIGN",
        event: "MESSAGE_SENT",
        status: "SUCCESS",
        message: `${sender.phoneNumber} sent a campaign message to ${job.targetPhone}.`,
        metadata: { jobId: job.id, campaignName: job.campaignName, senderPhone: sender.phoneNumber, targetPhone: job.targetPhone, proxyIp: sender.proxyIp, messageBody: finalMessageBody },
      });

      return NextResponse.json({ success: true, processedJobId: job.id, status: "SENT" });

    } catch (error: unknown) {
      const errorReason = errorToReason(error);
      
      await logMessageResult(sender.phoneNumber, job.targetPhone, finalMessageBody, "FAILED", errorReason);

      await prisma.campaignQueue.update({
        where: { id: job.id },
        data: { status: "FAILED", errorReason },
      });
      await recordActivity({
        source: "CAMPAIGN",
        event: "MESSAGE_FAILED",
        status: "FAILED",
        message: `Campaign message to ${job.targetPhone} failed: ${errorReason}`,
        metadata: { jobId: job.id, campaignName: job.campaignName, senderPhone: sender.phoneNumber, targetPhone: job.targetPhone, proxyIp: sender.proxyIp, messageBody: finalMessageBody, errorReason },
      });

      return NextResponse.json({ error: errorReason }, { status: 500 });
    } finally {
      unlockSender(sender.phoneNumber);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Worker failed.";
    await recordActivity({ source: "CAMPAIGN", event: "WORKER_FAILED", status: "FAILED", message: errorMsg });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
