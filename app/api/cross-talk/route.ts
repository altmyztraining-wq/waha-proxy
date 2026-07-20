import { NextResponse } from "next/server";
import { prisma, listSenders, logMessageResult, logActivity, getChatHistory, getLeastRecentlyUsedSenderPair, lockSender, unlockSender, isSenderBusy } from "@/app/lib/db";
import { sendWahaText, setWahaPresence, setWahaSeen, checkProxyHealth, calculateTypingTime, listWahaSessions, WahaError } from "@/app/lib/waha";
import { generateCrossTalkMessage, RateLimitError } from "@/app/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordActivity(input: Parameters<typeof logActivity>[0]) {
  try {
    await logActivity(input);
  } catch (error) {
    console.error("[AUDIT] Unable to persist cross-talk activity.", error);
  }
}

function deliveryErrorReason(error: unknown) {
  if (error instanceof WahaError) {
    const details = error.details === undefined
      ? ""
      : typeof error.details === "string"
        ? error.details
        : JSON.stringify(error.details);
    return [`WAHA ${error.status}`, error.message, details].filter(Boolean).join(" - ");
  }
  return error instanceof Error ? error.message : "AI message delivery failed.";
}

async function sendAndLogAiBubble(input: {
  sessionName: string;
  senderPhone: string;
  targetPhone: string;
  proxyIp: string;
  message: string;
}) {
  try {
    await sendWahaText({
      sessionName: input.sessionName,
      phoneNumber: input.targetPhone,
      message: input.message,
    });
    await logMessageResult(input.senderPhone, input.targetPhone, input.message, "SENT");
  } catch (error) {
    const errorReason = deliveryErrorReason(error);
    await logMessageResult(input.senderPhone, input.targetPhone, input.message, "FAILED", errorReason);
    const sender = await prisma.wahaSender.findUnique({
      where: { phoneNumber: input.senderPhone },
      select: { status: true },
    });
    await recordActivity({
      source: "CROSS_TALK",
      event: "MESSAGE_FAILED",
      status: "FAILED",
      message: `${input.senderPhone} failed to send an AI message to ${input.targetPhone}: ${errorReason}`,
      metadata: {
        senderPhone: input.senderPhone,
        targetPhone: input.targetPhone,
        proxyIp: input.proxyIp,
        messageBody: input.message,
        errorReason,
        senderStatusAfterFailure: sender?.status ?? "UNKNOWN",
      },
    });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const manual = new URL(request.url).searchParams.get("manual") === "true";
    if (!manual) {
      const latestSystemEvent = await prisma.activityLog.findFirst({
        where: { source: "SYSTEM", event: { in: ["UNIFIED_AUTOPILOT_STARTED", "UNIFIED_AUTOPILOT_STOPPED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (latestSystemEvent?.event !== "UNIFIED_AUTOPILOT_STARTED") {
        return NextResponse.json({ message: "System is stopped." });
      }
    }
    const senders = await listSenders();
    const sessions = await listWahaSessions();
    const livePhoneBySession = new Map(
      sessions
        .filter((session) => session.status === "WORKING" && session.name && session.me?.id)
        .map((session) => [session.name as string, session.me!.id!.split("@")[0]])
    );
    const activeSenders = senders.filter(
      (sender) =>
        sender.status === "ACTIVE" &&
        livePhoneBySession.get(sender.sessionName) === sender.phoneNumber &&
        !isSenderBusy(sender.phoneNumber)
    );

    if (activeSenders.length < 2) {
      await recordActivity({ source: "CROSS_TALK", event: "WAITING_FOR_SENDERS", status: "WARNING", message: "Cross-talk needs at least two available ACTIVE and WORKING senders." });
      return NextResponse.json(
        { error: "Need at least 2 ACTIVE senders for cross-talk." },
        { status: 400 }
      );
    }

    const selectedPair = await getLeastRecentlyUsedSenderPair(activeSenders);
    if (!selectedPair) {
      return NextResponse.json({ error: "No eligible sender pair is available." }, { status: 400 });
    }
    const [sender1, sender2] = selectedPair;
    await recordActivity({
      source: "CROSS_TALK",
      event: "PAIR_SELECTED",
      status: "INFO",
      message: `Selected pair ${sender1.phoneNumber} ↔ ${sender2.phoneNumber}.`,
      metadata: { sender1: sender1.phoneNumber, sender2: sender2.phoneNumber },
    });

    // Health check both proxies
    const isS1Healthy = await checkProxyHealth(sender1.proxyIp);
    const isS2Healthy = await checkProxyHealth(sender2.proxyIp);

    if (!isS1Healthy || !isS2Healthy) {
      await recordActivity({
        source: "CROSS_TALK",
        event: "PROXY_CHECK_FAILED",
        status: "FAILED",
        message: `Proxy check failed for pair ${sender1.phoneNumber} ↔ ${sender2.phoneNumber}.`,
        metadata: { sender1: sender1.phoneNumber, sender2: sender2.phoneNumber },
      });
      return NextResponse.json(
        { error: "One or both proxies are offline. Skipping cross-talk." },
        { status: 400 }
      );
    }

    lockSender(sender1.phoneNumber);
    lockSender(sender2.phoneNumber);

    try {

    // 1. Fetch Chat History & Generate Message(s) from S1 to S2
    const chatHistory = await getChatHistory(sender1.phoneNumber, sender2.phoneNumber, 6);
    const msg1Array = await generateCrossTalkMessage(sender1.phoneNumber, sender2.phoneNumber, false, chatHistory);
    
    // S1 Opens Chat
    await setWahaSeen({ sessionName: sender1.sessionName, phoneNumber: sender2.phoneNumber });
    await sleep(Math.floor(Math.random() * 15000) + 5000); // 5-20s before the first message

    const conversation: {from: string, to: string, message: string}[] = [];

    // S1 sends consecutive messages
    for (let i = 0; i < msg1Array.length; i++) {
      const msg = msg1Array[i];
      await setWahaPresence({
        sessionName: sender1.sessionName,
        phoneNumber: sender2.phoneNumber,
        presence: "typing",
      });
      
      await sleep(calculateTypingTime(msg)); // Highly realistic random typing duration
      
      await setWahaPresence({
        sessionName: sender1.sessionName,
        phoneNumber: sender2.phoneNumber,
        presence: "paused",
      });
      await sleep(Math.floor(Math.random() * 4000) + 2000); // 2-6s before sending

      await sendAndLogAiBubble({
        sessionName: sender1.sessionName,
        senderPhone: sender1.phoneNumber,
        targetPhone: sender2.phoneNumber,
        proxyIp: sender1.proxyIp,
        message: msg,
      });
      await recordActivity({ source: "CROSS_TALK", event: "MESSAGE_SENT", status: "SUCCESS", message: `${sender1.phoneNumber} sent an AI message to ${sender2.phoneNumber}.`, metadata: { senderPhone: sender1.phoneNumber, targetPhone: sender2.phoneNumber, proxyIp: sender1.proxyIp, messageBody: msg } });
      conversation.push({ from: sender1.phoneNumber, to: sender2.phoneNumber, message: msg });

      // If there is another message coming, wait a very short time before starting to type again
      if (i < msg1Array.length - 1) {
        await sleep(Math.floor(Math.random() * 9000) + 3000); // 3-12s between message bubbles
      }
    }

    // Broad response window; occasionally pause for several minutes.
    const isDistracted = Math.random() > 0.8;
    if (isDistracted) {
      await sleep(Math.floor(Math.random() * 120000) + 60000); // 1-3 mins
    } else {
      await sleep(Math.floor(Math.random() * 45000) + 15000); // 15-60s
    }

    // S2 Opens Chat & Reads (Blue Ticks appear for S1)
    await setWahaSeen({ sessionName: sender2.sessionName, phoneNumber: sender1.phoneNumber });
    await sleep(Math.floor(Math.random() * 15000) + 5000); // 5-20s reading time

    // 2. Generate Reply from S2 to S1 (Passing the last message as context)
    const contextForS2 = msg1Array.join(" ");
    const msg2Array = await generateCrossTalkMessage(sender2.phoneNumber, sender1.phoneNumber, true, contextForS2);

    // S2 sends consecutive replies
    for (let i = 0; i < msg2Array.length; i++) {
      const msg = msg2Array[i];
      await setWahaPresence({
        sessionName: sender2.sessionName,
        phoneNumber: sender1.phoneNumber,
        presence: "typing",
      });

      await sleep(calculateTypingTime(msg));

      await setWahaPresence({
        sessionName: sender2.sessionName,
        phoneNumber: sender1.phoneNumber,
        presence: "paused",
      });
      await sleep(Math.floor(Math.random() * 4000) + 2000);

      await sendAndLogAiBubble({
        sessionName: sender2.sessionName,
        senderPhone: sender2.phoneNumber,
        targetPhone: sender1.phoneNumber,
        proxyIp: sender2.proxyIp,
        message: msg,
      });
      await recordActivity({ source: "CROSS_TALK", event: "MESSAGE_SENT", status: "SUCCESS", message: `${sender2.phoneNumber} replied to ${sender1.phoneNumber}.`, metadata: { senderPhone: sender2.phoneNumber, targetPhone: sender1.phoneNumber, proxyIp: sender2.proxyIp, messageBody: msg } });
      conversation.push({ from: sender2.phoneNumber, to: sender1.phoneNumber, message: msg });

      if (i < msg2Array.length - 1) {
        await sleep(Math.floor(Math.random() * 9000) + 3000);
      }
    }

    // S1 Finally Reads the Reply (Completing the loop naturally)
    await sleep(Math.floor(Math.random() * 20000) + 10000);
    await setWahaSeen({ sessionName: sender1.sessionName, phoneNumber: sender2.phoneNumber });
    await recordActivity({ source: "CROSS_TALK", event: "CONVERSATION_COMPLETED", status: "SUCCESS", message: `Conversation completed for ${sender1.phoneNumber} ↔ ${sender2.phoneNumber}.`, metadata: { sender1: sender1.phoneNumber, sender2: sender2.phoneNumber, messageCount: conversation.length } });

    return NextResponse.json({
      success: true,
      conversation
    });
    } catch (error: unknown) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          { error: error.message, retryDelayMs: error.retryDelayMs },
          { status: 429 }
        );
      }
      const errorMsg = error instanceof Error ? error.message : "Cross-talk failed.";
      await recordActivity({ source: "CROSS_TALK", event: "CONVERSATION_FAILED", status: "FAILED", message: errorMsg, metadata: { sender1: sender1.phoneNumber, sender2: sender2.phoneNumber } });
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    } finally {
      unlockSender(sender1.phoneNumber);
      unlockSender(sender2.phoneNumber);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Cross-talk initialization failed.";
    await recordActivity({ source: "CROSS_TALK", event: "INITIALIZATION_FAILED", status: "FAILED", message: errorMsg });
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
