import { NextResponse } from "next/server";
import {
  listSenders,
  type SenderStatus,
  upsertSender,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpsertSenderRequest = {
  phoneNumber?: string;
  sessionName?: string;
  status?: SenderStatus;
  maxDailyLimit?: number;
  proxyIp?: string;
};

const VALID_STATUSES = new Set<SenderStatus>(["ACTIVE", "BANNED", "RESTING"]);

function normalizePhoneNumber(value?: string) {
  return value?.replace(/\D/g, "") ?? "";
}

function getDefaultProxyServer() {
  const proxyUrl = process.env.WAHA_SESSION_PROXY_URL?.trim();
  if (!proxyUrl) {
    return "";
  }

  try {
    const url = new URL(proxyUrl);
    return `${url.hostname}:${url.port}`;
  } catch {
    return proxyUrl.replace(/^https?:\/\//, "");
  }
}

export async function GET() {
  const senders = await listSenders();
  return NextResponse.json({ senders });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpsertSenderRequest;
    const phoneNumber = normalizePhoneNumber(body.phoneNumber);
    const sessionName = body.sessionName?.trim() ?? "";
    const status = body.status ?? "ACTIVE";
    const maxDailyLimit = Number(body.maxDailyLimit ?? 20);
    const proxyIp = body.proxyIp?.trim() || getDefaultProxyServer();

    if (!/^\d{8,15}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: "Sender phone number must include 8-15 digits." },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(sessionName)) {
      return NextResponse.json(
        { error: "Session name must be 3-64 safe characters." },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "Sender status must be ACTIVE, BANNED, or RESTING." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(maxDailyLimit) || maxDailyLimit < 1 || maxDailyLimit > 100) {
      return NextResponse.json(
        { error: "Max daily limit must be an integer from 1 to 100." },
        { status: 400 }
      );
    }

    if (!proxyIp) {
      return NextResponse.json(
        { error: "Proxy IP is required." },
        { status: 400 }
      );
    }

    const sender = await upsertSender({
      phoneNumber,
      sessionName,
      status,
      maxDailyLimit,
      proxyIp,
    });

    return NextResponse.json({ success: true, sender });
  } catch {
    return NextResponse.json(
      { error: "Unable to save sender." },
      { status: 500 }
    );
  }
}
