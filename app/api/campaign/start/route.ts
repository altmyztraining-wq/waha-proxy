import { NextResponse } from "next/server";
import {
  getNextRoundRobinSender,
  resetRoundRobin,
  logMessageResult,
  type MessageDeliveryStatus,
} from "@/app/lib/db";
import { sendWahaText, WahaError, checkProxyHealth, setWahaPresence, listWahaSessions } from "@/app/lib/waha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CampaignStartRequest = {
  targetPhones?: string[] | string;
  messageBody?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
};

type CampaignResult = {
  targetPhone: string;
  senderPhone?: string;
  status: MessageDeliveryStatus;
  errorReason?: string;
};

const MAX_CAMPAIGN_MESSAGES = 100;
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSpintax(text: string) {
  return text.replace(/\{([^{}]+)\}/g, (_, options) => {
    const opts = options.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

function normalizeTargets(value: string[] | string | undefined) {
  const rawValues = Array.isArray(value)
    ? value
    : (value ?? "").split(/[\n,; ]+/);

  return Array.from(
    new Set(
      rawValues
        .map((target) => target.replace(/\D/g, ""))
        .filter((target) => /^\d{8,15}$/.test(target))
    )
  );
}

function normalizeDelay(min?: number, max?: number) {
  const minVal = Number.isFinite(min) ? Number(min) : 3_000;
  const maxVal = Number.isFinite(max) ? Number(max) : 8_000;

  return {
    minDelayMs: Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.floor(minVal))),
    maxDelayMs: Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.floor(maxVal))),
  };
}

function errorToReason(error: unknown) {
  if (error instanceof WahaError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Unexpected send failure.";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CampaignStartRequest;
    const baseMessageBody = body.messageBody?.trim() ?? "";
    const targets = normalizeTargets(body.targetPhones);
    const { minDelayMs, maxDelayMs } = normalizeDelay(body.minDelayMs, body.maxDelayMs);

    if (!baseMessageBody) {
      return NextResponse.json(
        { error: "Message body is required." },
        { status: 400 }
      );
    }

    if (targets.length === 0) {
      return NextResponse.json(
        { error: "Add at least one valid target phone number." },
        { status: 400 }
      );
    }

    if (targets.length > MAX_CAMPAIGN_MESSAGES) {
      return NextResponse.json(
        { error: "This PoC runner is capped at 100 messages per batch." },
        { status: 400 }
      );
    }

    const results: CampaignResult[] = [];
    resetRoundRobin();

    const sessions = await listWahaSessions();
    const workingSessionNames = sessions
      .filter((session) => session.status === "WORKING" && session.name)
      .map((session) => session.name as string);

    let lastProxyIp: string | undefined = undefined;

    for (const [index, targetPhone] of targets.entries()) {
      const sender = await getNextRoundRobinSender(lastProxyIp, workingSessionNames);

      if (!sender) {
        results.push({
          targetPhone,
          status: "FAILED",
          errorReason: "No ACTIVE sender available on a different IP, or all senders exhausted daily limit. Stopping.",
        });
        // If we can't find a sender with a different IP, we must break to avoid getting banned.
        // Wait, if it fails to find one, it could just skip this target, but this means there are no safe senders.
        break;
      }

      // Spintax parsing
      const finalMessageBody = parseSpintax(baseMessageBody);

      try {
        // Proxy Health Check
        const isProxyHealthy = await checkProxyHealth(sender.proxyIp);
        if (!isProxyHealthy) {
          throw new Error(`Proxy ${sender.proxyIp} is down or unreachable. Skipping to protect account.`);
        }

        // Simulate Human Typing
        await setWahaPresence({
          sessionName: sender.sessionName,
          phoneNumber: targetPhone,
          presence: "typing",
        });

        // Sleep based on message length to simulate typing (max 4 seconds)
        const typeTimeMs = Math.min(finalMessageBody.length * 100, 4000);
        await sleep(typeTimeMs);

        await sendWahaText({
          sessionName: sender.sessionName,
          phoneNumber: targetPhone,
          message: finalMessageBody,
        });

        await logMessageResult(
          sender.phoneNumber,
          targetPhone,
          finalMessageBody,
          "SENT"
        );

        results.push({
          targetPhone,
          senderPhone: sender.phoneNumber,
          status: "SENT",
        });

        lastProxyIp = sender.proxyIp;
      } catch (error: unknown) {
        const errorReason = errorToReason(error);

        await logMessageResult(
          sender.phoneNumber,
          targetPhone,
          finalMessageBody,
          "FAILED",
          errorReason
        );

        results.push({
          targetPhone,
          senderPhone: sender.phoneNumber,
          status: "FAILED",
          errorReason,
        });
      }

      if (index < targets.length - 1) {
        // Random Delay
        const delay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
        await sleep(delay);
      }
    }

    return NextResponse.json({
      success: true,
      delayRange: `${minDelayMs}ms - ${maxDelayMs}ms`,
      totalRequested: targets.length,
      sent: results.filter((result) => result.status === "SENT").length,
      failed: results.filter((result) => result.status === "FAILED").length,
      results,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to start campaign." },
      { status: 500 }
    );
  }
}
