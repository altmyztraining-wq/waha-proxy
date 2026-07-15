import { NextResponse } from "next/server";
import { listSenders, getNextRoundRobinSender, logMessageResult, getChatHistory, lockSender, unlockSender, isSenderBusy } from "@/app/lib/db";
import { sendWahaText, setWahaPresence, setWahaSeen, checkProxyHealth, calculateTypingTime } from "@/app/lib/waha";
import { generateCrossTalkMessage, RateLimitError } from "@/app/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  try {
    const senders = await listSenders();
    const activeSenders = senders.filter((s) => s.status === "ACTIVE" && !isSenderBusy(s.phoneNumber));

    if (activeSenders.length < 2) {
      return NextResponse.json(
        { error: "Need at least 2 ACTIVE senders for cross-talk." },
        { status: 400 }
      );
    }

    // Pick two random active senders
    const sender1 = activeSenders[Math.floor(Math.random() * activeSenders.length)];
    // Ensure they have different IP addresses (prevent same-phone chat)
    let availableForS2 = activeSenders.filter((s) => s.proxyIp !== sender1.proxyIp);
    
    if (availableForS2.length === 0) {
      return NextResponse.json(
        { error: "Need at least 2 ACTIVE senders on DIFFERENT proxy IPs (different phones) for cross-talk." },
        { status: 400 }
      );
    }

    const sender2 = availableForS2[Math.floor(Math.random() * availableForS2.length)];

    // Health check both proxies
    const isS1Healthy = await checkProxyHealth(sender1.proxyIp);
    const isS2Healthy = await checkProxyHealth(sender2.proxyIp);

    if (!isS1Healthy || !isS2Healthy) {
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
    await sleep(Math.floor(Math.random() * 1500) + 1000); // 1-2.5s thinking

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
      await sleep(Math.floor(Math.random() * 800) + 400); // Slight pause before hitting send

      await sendWahaText({
        sessionName: sender1.sessionName,
        phoneNumber: sender2.phoneNumber,
        message: msg,
      });
      await logMessageResult(sender1.phoneNumber, sender2.phoneNumber, msg, "SENT");
      conversation.push({ from: sender1.phoneNumber, to: sender2.phoneNumber, message: msg });

      // If there is another message coming, wait a very short time before starting to type again
      if (i < msg1Array.length - 1) {
        await sleep(Math.floor(Math.random() * 1500) + 500);
      }
    }

    // Realistic time for S2 to receive notification and open phone (e.g., 4 to 12 seconds)
    // 15% chance to get "distracted" and wait much longer (up to 2 minutes)
    const isDistracted = Math.random() > 0.85;
    if (isDistracted) {
      await sleep(Math.floor(Math.random() * 90000) + 30000); // 30s to 2 mins
    } else {
      await sleep(Math.floor(Math.random() * 8000) + 4000); // 4-12s
    }

    // S2 Opens Chat & Reads (Blue Ticks appear for S1)
    await setWahaSeen({ sessionName: sender2.sessionName, phoneNumber: sender1.phoneNumber });
    await sleep(Math.floor(Math.random() * 3000) + 1500); // 1.5-4.5s reading the message

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
      await sleep(Math.floor(Math.random() * 800) + 400);

      await sendWahaText({
        sessionName: sender2.sessionName,
        phoneNumber: sender1.phoneNumber,
        message: msg,
      });
      await logMessageResult(sender2.phoneNumber, sender1.phoneNumber, msg, "SENT");
      conversation.push({ from: sender2.phoneNumber, to: sender1.phoneNumber, message: msg });

      if (i < msg2Array.length - 1) {
        await sleep(Math.floor(Math.random() * 1500) + 500);
      }
    }

    // S1 Finally Reads the Reply (Completing the loop naturally)
    await sleep(Math.floor(Math.random() * 3000) + 3000);
    await setWahaSeen({ sessionName: sender1.sessionName, phoneNumber: sender2.phoneNumber });

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
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    } finally {
      unlockSender(sender1.phoneNumber);
      unlockSender(sender2.phoneNumber);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Cross-talk initialization failed.";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
