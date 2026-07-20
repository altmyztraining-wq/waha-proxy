import { NextResponse } from "next/server";
import { prisma, getNextRoundRobinSender, logMessageResult, lockSender, unlockSender } from "@/app/lib/db";
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

export async function POST() {
  try {
    const sessions = await listWahaSessions();
    const workingSessionNames = sessions
      .filter((session) => session.status === "WORKING" && session.name)
      .map((session) => session.name as string);

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

    // 3. Find available sender
    const sender = await getNextRoundRobinSender(undefined, workingSessionNames);
    if (!sender) {
      // Revert to pending so it can be retried later
      await prisma.campaignQueue.update({
        where: { id: job.id },
        data: { status: "PENDING" },
      });
      return NextResponse.json({ error: "No available senders. Re-queued." }, { status: 400 });
    }

    const finalMessageBody = parseSpintax(job.messageBody);

    lockSender(sender.phoneNumber);

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

      return NextResponse.json({ success: true, processedJobId: job.id, status: "SENT" });

    } catch (error: unknown) {
      const errorReason = errorToReason(error);
      
      await logMessageResult(sender.phoneNumber, job.targetPhone, finalMessageBody, "FAILED", errorReason);

      await prisma.campaignQueue.update({
        where: { id: job.id },
        data: { status: "FAILED", errorReason },
      });

      return NextResponse.json({ error: errorReason }, { status: 500 });
    } finally {
      unlockSender(sender.phoneNumber);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Worker failed.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
