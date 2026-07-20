import { PrismaClient, type MessageLog, type WahaSender } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type SenderStatus = "ACTIVE" | "BANNED" | "RESTING" | "OFFLINE";
export type MessageDeliveryStatus = "SENT" | "FAILED" | "PENDING";

export type UpsertSenderInput = {
  phoneNumber: string;
  sessionName: string;
  status: SenderStatus;
  maxDailyLimit: number;
  proxyIp: string;
};

const META_BAN_ERROR_PATTERNS = [
  "banned",
  "ban",
  "blocked by whatsapp",
  "account disabled",
  "account banned",
  "temporarily unavailable",
  "not allowed",
  "logged out",
  "unpaired",
  "403",
  "401",
];

const SESSION_CLOSED_ERROR_PATTERNS = [
  "session status is not as expected",
  '"status":"failed"',
  "session not found",
  "unprocessable entity"
];

function looksLikeMetaBan(errorReason?: string | null) {
  if (!errorReason) {
    return false;
  }

  const normalized = errorReason.toLowerCase();
  return META_BAN_ERROR_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

function looksLikeSessionClosed(errorReason?: string | null) {
  if (!errorReason) {
    return false;
  }

  const normalized = errorReason.toLowerCase();
  return SESSION_CLOSED_ERROR_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

export async function resetDailySentCountsIfNewDay() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  await prisma.wahaSender.updateMany({
    where: {
      lastActiveAt: {
        lt: todayStart,
      },
      dailySentCount: {
        gt: 0,
      },
    },
    data: {
      dailySentCount: 0,
    },
  });
}

export async function getAvailableSender(
  excludePhones: string[] = []
): Promise<WahaSender | null> {
  await resetDailySentCountsIfNewDay();
  const activeSenders = await prisma.wahaSender.findMany({
    where: {
      status: "ACTIVE",
      ...(excludePhones.length > 0
        ? { phoneNumber: { notIn: excludePhones } }
        : {}),
    },
    orderBy: [
      {
        dailySentCount: "asc",
      },
      {
        lastActiveAt: "desc",
      },
    ],
  });

  return (
    activeSenders.find(
      (sender) => sender.dailySentCount < sender.maxDailyLimit
    ) ?? null
  );
}

/**
 * Global In-Memory Mutex for Senders.
 * Ensures that a single WhatsApp number is never used simultaneously
 * by the Campaign Queue and the Cross-Talk Engine.
 */
const busySenders = new Set<string>();

export function lockSender(phone: string) {
  busySenders.add(phone);
}

export function unlockSender(phone: string) {
  busySenders.delete(phone);
}

export function isSenderBusy(phone: string) {
  return busySenders.has(phone);
}

/**
 * Round-robin sender selection for campaigns.
 * Cycles through available ACTIVE senders that are under their daily limit,
 * distributing messages evenly across phones/proxies.
 */
let _rrIndex = Math.floor(Math.random() * 1000);

export async function getNextRoundRobinSender(
  lastUsedProxyIp?: string,
  liveSenderIdentities?: Array<{ phoneNumber: string; sessionName: string }>
): Promise<WahaSender | null> {
  if (liveSenderIdentities && liveSenderIdentities.length === 0) return null;

  await resetDailySentCountsIfNewDay();
  const activeSenders = await prisma.wahaSender.findMany({
    where: {
      status: "ACTIVE",
      ...(liveSenderIdentities
        ? {
            OR: liveSenderIdentities.map((identity) => ({
              phoneNumber: identity.phoneNumber,
              sessionName: identity.sessionName,
            })),
          }
        : {}),
    },
    orderBy: {
      phoneNumber: "asc",
    },
  });

  let available = activeSenders.filter(
    (s) => s.dailySentCount < s.maxDailyLimit && !isSenderBusy(s.phoneNumber)
  );

  if (lastUsedProxyIp) {
    // Strictly filter out any sender that shares the same proxy IP
    available = available.filter((s) => s.proxyIp !== lastUsedProxyIp);
  }

  if (available.length === 0) return null;

  const sender = available[_rrIndex % available.length];
  _rrIndex++;
  return sender;
}

export function resetRoundRobin() {
  _rrIndex = 0;
}

export async function listSenders(): Promise<WahaSender[]> {
  await resetDailySentCountsIfNewDay();
  return prisma.wahaSender.findMany({
    orderBy: [
      {
        status: "asc",
      },
      {
        lastActiveAt: "desc",
      },
    ],
  });
}

/**
 * Selects the pair that has gone the longest without interacting.
 * New pairs have priority, so every unique pair is covered before repetition.
 */
export async function getLeastRecentlyUsedSenderPair(
  senders: WahaSender[]
): Promise<[WahaSender, WahaSender] | null> {
  if (senders.length < 2) return null;

  const phones = senders.map((sender) => sender.phoneNumber);
  const interactions = await prisma.messageLog.findMany({
    where: {
      senderPhone: { in: phones },
      targetPhone: { in: phones },
    },
    select: {
      senderPhone: true,
      targetPhone: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const latestByPair = new Map<string, number>();
  for (const interaction of interactions) {
    if (interaction.senderPhone === interaction.targetPhone) continue;
    const key = [interaction.senderPhone, interaction.targetPhone].sort().join(":");
    if (!latestByPair.has(key)) {
      latestByPair.set(key, interaction.createdAt.getTime());
    }
  }

  const pairs: Array<{ pair: [WahaSender, WahaSender]; lastInteraction: number }> = [];
  for (let first = 0; first < senders.length; first++) {
    for (let second = first + 1; second < senders.length; second++) {
      const key = [senders[first].phoneNumber, senders[second].phoneNumber].sort().join(":");
      pairs.push({
        pair: [senders[first], senders[second]],
        lastInteraction: latestByPair.get(key) ?? 0,
      });
    }
  }

  pairs.sort((left, right) =>
    left.lastInteraction - right.lastInteraction ||
    left.pair[0].phoneNumber.localeCompare(right.pair[0].phoneNumber) ||
    left.pair[1].phoneNumber.localeCompare(right.pair[1].phoneNumber)
  );

  return pairs[0]?.pair ?? null;
}

export async function upsertSender({
  phoneNumber,
  sessionName,
  status,
  maxDailyLimit,
  proxyIp,
}: UpsertSenderInput): Promise<WahaSender> {
  return prisma.wahaSender.upsert({
    where: {
      phoneNumber,
    },
    create: {
      phoneNumber,
      sessionName,
      status,
      dailySentCount: 0,
      maxDailyLimit,
      proxyIp,
      lastActiveAt: new Date(),
    },
    update: {
      sessionName,
      status,
      maxDailyLimit,
      proxyIp,
      lastActiveAt: new Date(),
    },
  });
}

type LiveWahaSession = {
  name?: string;
  status?: string;
  me?: { id?: string } | null;
  config?: { proxy?: { server?: string } };
};

/**
 * Makes SQLite reflect WAHA before monitor data is returned.
 * Missing/non-working sessions are kept for history but cannot be selected.
 */
export async function syncSendersWithWahaSessions(sessions: LiveWahaSession[]) {
  const workingSessions = sessions.filter(
    (session) => session.status === "WORKING" && session.name && session.me?.id
  );
  const workingNames = workingSessions.map((session) => session.name as string);

  await prisma.$transaction(async (tx) => {
    await tx.wahaSender.updateMany({
      where: {
        status: "ACTIVE",
        ...(workingNames.length > 0
          ? { sessionName: { notIn: workingNames } }
          : {}),
      },
      data: { status: "OFFLINE" },
    });

    for (const session of workingSessions) {
      const phoneNumber = session.me!.id!.split("@")[0];
      if (!/^\d{8,15}$/.test(phoneNumber)) continue;

      const existing = await tx.wahaSender.findUnique({ where: { phoneNumber } });
      if (existing) {
        await tx.wahaSender.update({
          where: { phoneNumber },
          data: {
            sessionName: session.name!,
            status: existing.status === "OFFLINE" ? "ACTIVE" : existing.status,
            proxyIp: session.config?.proxy?.server ?? existing.proxyIp,
            lastActiveAt: new Date(),
          },
        });
      } else {
        await tx.wahaSender.create({
          data: {
            phoneNumber,
            sessionName: session.name!,
            status: "ACTIVE",
            maxDailyLimit: 50,
            proxyIp: session.config?.proxy?.server ?? "",
          },
        });
      }
    }
  });
}

export async function getRecentMessageLogs(limit = 50): Promise<MessageLog[]> {
  return prisma.messageLog.findMany({
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function logActivity(input: {
  source: "CAMPAIGN" | "CROSS_TALK" | "AUTO_REPLY" | "SYSTEM";
  event: string;
  status: "INFO" | "SUCCESS" | "WARNING" | "FAILED";
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.activityLog.create({
    data: {
      source: input.source,
      event: input.event,
      status: input.status,
      message: input.message,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function getRecentActivityLogs(limit = 100) {
  return prisma.activityLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
  });
}

export async function getMessageStats() {
  const rows = await prisma.messageLog.groupBy({
    by: ["status"],
    _count: {
      _all: true,
    },
  });

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}

export async function getSenderStats() {
  const rows = await prisma.wahaSender.groupBy({
    by: ["status"],
    _count: {
      _all: true,
    },
  });

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}

export async function logMessageResult(
  senderPhone: string,
  targetPhone: string,
  body: string,
  status: MessageDeliveryStatus,
  errorReason?: string | null
): Promise<MessageLog> {
  return prisma.$transaction(async (tx) => {
    const messageLog = await tx.messageLog.create({
      data: {
        senderPhone,
        targetPhone,
        messageBody: body,
        status,
        errorReason: errorReason ?? null,
      },
    });

    if (status === "SENT") {
      await tx.wahaSender.update({
        where: {
          phoneNumber: senderPhone,
        },
        data: {
          dailySentCount: {
            increment: 1,
          },
          lastActiveAt: new Date(),
        },
      });
    }

    if (status === "FAILED") {
      if (looksLikeMetaBan(errorReason)) {
        await tx.wahaSender.update({
          where: {
            phoneNumber: senderPhone,
          },
          data: {
            status: "BANNED",
            lastActiveAt: new Date(),
          },
        });
      } else if (looksLikeSessionClosed(errorReason)) {
        await tx.wahaSender.update({
          where: {
            phoneNumber: senderPhone,
          },
          data: {
            status: "RESTING",
            lastActiveAt: new Date(),
          },
        });
      }
    }

    return messageLog;
  });
}

export async function getSenderAnalytics(senderPhone: string) {
  const rows = await prisma.messageLog.groupBy({
    by: ["status"],
    where: {
      senderPhone,
    },
    _count: {
      _all: true,
    },
  });

  let totalSent = 0;
  let totalFailed = 0;

  for (const row of rows) {
    if (row.status === "SENT") totalSent = row._count._all;
    if (row.status === "FAILED") totalFailed = row._count._all;
  }

  const total = totalSent + totalFailed;
  const successRate = total > 0 ? Math.round((totalSent / total) * 100) : 0;

  return {
    totalSent,
    totalFailed,
    successRate,
  };
}

export async function getChatHistory(phone1: string, phone2: string, limit: number = 6) {
  const messages = await prisma.messageLog.findMany({
    where: {
      OR: [
        { senderPhone: phone1, targetPhone: phone2 },
        { senderPhone: phone2, targetPhone: phone1 },
      ],
      status: "SENT"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: limit
  });

  // Reverse to get chronological order
  return messages.reverse().map(m => `[${m.senderPhone}]: ${m.messageBody}`).join("\n");
}
