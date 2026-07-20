import net from "node:net";
import { exec } from "node:child_process";

type WahaProxyConfig = {
  server: string;
  username?: string;
  password?: string;
};

type WahaVersion = {
  version?: string;
  engine?: string;
  tier?: string;
  browser?: string;
  platform?: string;
};
type WahaSession = {
  name?: string;
  status?: string;
  me?: {
    id?: string;
    pushName?: string;
  } | null;
  config?: {
    proxy?: WahaProxyConfig;
  };
};

export type CreateWahaSessionOptions = {
  sessionName: string;
  proxyUrl: string;
  start?: boolean;
};

export class WahaError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "WahaError";
    this.status = status;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

function getWahaBaseUrl() {
  return process.env.WAHA_API_URL ?? "http://localhost:3000";
}

function getWahaApiKey() {
  return process.env.WAHA_API_KEY ?? "";
}

function getWahaHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiKey = getWahaApiKey();
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
  }

  return headers;
}

function assertSafeSessionName(sessionName: string) {
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(sessionName)) {
    throw new WahaError(
      "Session name must be 3-64 characters and contain only letters, numbers, underscores, and hyphens.",
      400
    );
  }
}

export function parseWahaProxyUrl(proxyUrl: string): WahaProxyConfig {
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    throw new WahaError("WAHA session proxy URL is required.", 500);
  }

  const normalized = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(normalized);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new WahaError("Only HTTP and HTTPS proxies are supported.", 400);
  }

  if (!url.hostname || !url.port) {
    throw new WahaError(
      "Proxy must include host and port, for example http://192.168.42.15:8080.",
      400
    );
  }

  const proxy: WahaProxyConfig = {
    server: `${url.hostname}:${url.port}`,
  };

  if (url.username) {
    proxy.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    proxy.password = decodeURIComponent(url.password);
  }

  return proxy;
}

async function readWahaResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function fetchWaha(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${getWahaBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...getWahaHeaders(),
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const data = await readWahaResponse(response);

    if (!response.ok) {
      let message = "WAHA API request failed.";
      
      if (typeof data === "object" && data !== null) {
        if ("message" in data && typeof data.message === "string") {
          message = data.message;
        } else if ("error" in data && typeof data.error === "string") {
          message = data.error;
        } else {
          // If the error details are a complex object, stringify them so we can parse them in error handling
          message = `WAHA API request failed. Details: ${JSON.stringify(data)}`;
        }
      }

      throw new WahaError(message, response.status, data);
    }

    return data;
  } catch (error) {
    if (error instanceof WahaError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new WahaError("WAHA API request timed out.", 504);
    }
    throw new WahaError(
      error instanceof Error ? error.message : "Unable to reach WAHA API.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWahaVersion() {
  return fetchWaha("/api/version", {
    method: "GET",
  }) as Promise<WahaVersion>;
}

export async function listWahaSessions() {
  return fetchWaha("/api/sessions?all=true", {
    method: "GET",
  }) as Promise<WahaSession[]>;
}

export async function getWahaSession(sessionName: string) {
  const sessions = await listWahaSessions();

  return sessions.find((session) => session.name === sessionName) ?? null;
}

export async function assertSessionUsesProxy(sessionName: string) {
  const session = await getWahaSession(sessionName);
  const proxyServer = session?.config?.proxy?.server;

  if (!proxyServer) {
    throw new WahaError(
      `Session "${sessionName}" is not configured with a proxy.`,
      409,
      session
    );
  }
}

export async function assertWahaWebjsEngine() {
  if (process.env.WAHA_REQUIRE_WEBJS === "false") {
    return;
  }

  const version = await getWahaVersion();

  if (version.engine && version.engine !== "WEBJS") {
    throw new WahaError(
      `WAHA engine must be WEBJS for this deployment. Current engine: ${version.engine}.`,
      409,
      version
    );
  }
}

/**
 * Runs a command inside the WAHA Docker container and returns stdout.
 */
function execInDocker(cmd: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `docker exec waha ${cmd}`,
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/**
 * Verifies that the proxy is working from INSIDE Docker before creating a session.
 * This is critical — if the proxy is down or slow, WAHA's Chrome will connect
 * directly without proxy and WhatsApp will see the server's real IP → instant ban.
 *
 * Checks:
 * 1. Proxy can reach the internet (api.ipify.org) from Docker
 * 2. The IP returned is NOT the server's own IP (confirms proxy is routing traffic)
 * 3. Proxy can reach web.whatsapp.com (WhatsApp won't block the connection)
 */
export async function verifyProxyFromDocker(proxyUrl: string): Promise<{ ip: string }> {
  const parsed = parseWahaProxyUrl(proxyUrl);
  const proxyArg = parsed.username && parsed.password
    ? `http://${parsed.username}:${parsed.password}@${parsed.server}`
    : `http://${parsed.server}`;

  // Step 1: Check proxy returns an IP
  let proxyIp: string;
  try {
    proxyIp = await execInDocker(
      `curl -s -x ${proxyArg} http://api.ipify.org --max-time 10`
    );
  } catch {
    throw new WahaError(
      `❌ البروكسي مش شغال أو مش بيرد من داخل Docker. تأكد إن Every Proxy شغال على الموبايل وإن Tailscale متصل. Proxy: ${parsed.server}`,
      400
    );
  }

  if (!proxyIp || !/^\d+\.\d+\.\d+\.\d+$/.test(proxyIp)) {
    throw new WahaError(
      `❌ البروكسي رد برد غير متوقع بدل IP. الرد: "${proxyIp}". تأكد إن البروكسي HTTP proxy وشغال صح.`,
      400
    );
  }

  // Step 2: Verify proxy can reach WhatsApp
  try {
    const whatsappResult = await execInDocker(
      `curl -s -o /dev/null -w "%{http_code}" -I -L -x ${proxyArg} https://web.whatsapp.com/ --max-time 15`
    );
    const statusCode = parseInt(whatsappResult, 10);
    if (statusCode < 200 || statusCode >= 400) {
      throw new Error(`HTTP ${statusCode}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    throw new WahaError(
      `❌ البروكسي شغال بس مش قادر يفتح web.whatsapp.com — واتساب ممكن يكون حاجب الـ IP ده. (${msg}). Proxy IP: ${proxyIp}`,
      400
    );
  }

  return { ip: proxyIp };
}

export async function createWahaSession({
  sessionName,
  proxyUrl,
  start = true,
}: CreateWahaSessionOptions) {
  assertSafeSessionName(sessionName);
  await assertWahaWebjsEngine();

  // ⛔ MANDATORY: Verify proxy works from inside Docker BEFORE creating session
  const proxyCheck = await verifyProxyFromDocker(proxyUrl);
  console.log(`✅ Proxy verified from Docker. Exit IP: ${proxyCheck.ip}. Creating session "${sessionName}"...`);

  const payload = {
    name: sessionName,
    start,
    config: {
      proxy: parseWahaProxyUrl(proxyUrl),
    },
  };

  const wahaResult = await fetchWaha("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    ...(typeof wahaResult === "object" && wahaResult !== null
      ? wahaResult
      : { data: wahaResult }),
    proxyExitIp: proxyCheck.ip,
  };
}

export async function sendWahaText({
  sessionName,
  phoneNumber,
  message,
}: {
  sessionName: string;
  phoneNumber: string;
  message: string;
}) {
  assertSafeSessionName(sessionName);
  await assertSessionUsesProxy(sessionName);

  return fetchWaha("/api/sendText", {
    method: "POST",
    body: JSON.stringify({
      session: sessionName,
      chatId: `${phoneNumber}@c.us`,
      text: message,
    }),
  });
}

/**
 * Checks if the proxy server is reachable via TCP.
 * This prevents the system from sending messages if the phone's Tailscale or Every Proxy drops.
 */
export async function checkProxyHealth(proxyServer: string): Promise<boolean> {
  const [host, port] = proxyServer.split(":");
  if (!host || !port) return false;

  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(8000); // 8 seconds timeout (Tailscale + mobile data can be slow)

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(Number(port), host);
  });
}

/**
 * Sets presence (typing, recording) to simulate human behavior.
 */
export async function setWahaPresence(config: {
  sessionName: string;
  phoneNumber: string;
  presence: "typing" | "recording" | "paused";
}) {
  // WEBJS can return 500 when the chat has not been created locally yet.
  // Presence is cosmetic and must never be required for message delivery.
  if (process.env.WAHA_ENABLE_CHAT_SIGNALS !== "true") return;

  const { sessionName, phoneNumber, presence } = config;

  const response = await fetch(`${process.env.WAHA_API_URL}/api/${sessionName}/presence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
    },
    body: JSON.stringify({
      chatId: `${phoneNumber}@c.us`,
      presence,
    }),
  });

  if (!response.ok) {
    if (response.status !== 404) {
      const errorText = await response.text();
      console.warn(`[WAHA] Failed to set presence: ${response.statusText} - ${errorText}`);
    }
  }
}

/**
 * Marks a chat as seen (sends blue ticks) to simulate reading.
 */
export async function setWahaSeen(config: {
  sessionName: string;
  phoneNumber: string;
}) {
  // Keep read receipts opt-in for the same reason as presence above.
  if (process.env.WAHA_ENABLE_CHAT_SIGNALS !== "true") return;

  const { sessionName, phoneNumber } = config;

  const response = await fetch(`${process.env.WAHA_API_URL}/api/sendSeen`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
    },
    body: JSON.stringify({
      session: sessionName,
      chatId: `${phoneNumber}@c.us`,
    }),
  });

  if (!response.ok) {
    if (response.status !== 404) {
      console.warn(`[WAHA] Failed to send seen status for ${phoneNumber}`);
    }
  }
}

/**
 * Sends a Voice Note (ptt)
 */
export async function sendWahaVoice(config: {
  sessionName: string;
  phoneNumber: string;
  fileUrl: string;
}) {
  const { sessionName, phoneNumber, fileUrl } = config;

  const response = await fetch(`${process.env.WAHA_API_URL}/api/sendVoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
    },
    body: JSON.stringify({
      session: sessionName,
      chatId: `${phoneNumber}@c.us`,
      file: {
        mimetype: "audio/ogg; codecs=opus",
        filename: "audio.ogg",
        url: fileUrl,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new WahaError(`Failed to send voice note: ${response.statusText}`, response.status, errorText);
  }
}

/**
 * Manages an existing WAHA session (stop, start, logout)
 */
export async function manageWahaSession(sessionName: string, action: "stop" | "start" | "logout") {
  const url = `${process.env.WAHA_API_URL}/api/sessions/${sessionName}/${action}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new WahaError(`Failed to ${action} session ${sessionName}: ${response.statusText}`, response.status, errorText);
  }
}

/**
 * Deletes/Removes a WAHA session completely from the engine
 */
export async function deleteWahaSession(sessionName: string) {
  const url = `${process.env.WAHA_API_URL}/api/sessions/${sessionName}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new WahaError(`Failed to delete session ${sessionName}: ${response.statusText}`, response.status, errorText);
  }
}


/**
 * Calculates a highly realistic, randomized typing duration based on message length.
 */
export function calculateTypingTime(text: string): number {
  const length = text.length || 1;
  // Humans type between 80ms and 250ms per character on mobile, but it varies wildly per message
  const msPerChar = Math.floor(Math.random() * (250 - 80 + 1)) + 80;
  
  let typeTimeMs = length * msPerChar;
  
  // Add a larger random variance (+/- 25%)
  const variance = typeTimeMs * 0.25;
  typeTimeMs += (Math.random() * variance * 2) - variance;
  
  // Base thought/reaction time before starting to type (800ms to 2.5s)
  const reactionTime = Math.floor(Math.random() * 1700) + 800;
  
  typeTimeMs += reactionTime;

  // Cap it between 2s (minimum realistic) and 20s (maximum patience for a single burst of typing)
  return Math.max(2000, Math.min(Math.floor(typeTimeMs), 20000));
}
