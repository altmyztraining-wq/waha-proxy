import net from "node:net";

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

export async function createWahaSession({
  sessionName,
  proxyUrl,
  start = true,
}: CreateWahaSessionOptions) {
  assertSafeSessionName(sessionName);
  await assertWahaWebjsEngine();

  const payload = {
    name: sessionName,
    start,
    config: {
      proxy: parseWahaProxyUrl(proxyUrl),
    },
  };

  return fetchWaha("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
    socket.setTimeout(4000); // 4 seconds timeout

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
  // Humans type between 50ms and 150ms per character on mobile, but it varies wildly per message
  const msPerChar = Math.floor(Math.random() * (150 - 50 + 1)) + 50;
  
  let typeTimeMs = length * msPerChar;
  
  // Add a completely random variance (+/- 15%)
  const variance = typeTimeMs * 0.15;
  typeTimeMs += (Math.random() * variance * 2) - variance;
  
  // Base thought/reaction time before starting to type (300ms to 1s)
  const reactionTime = Math.floor(Math.random() * 700) + 300;
  
  typeTimeMs += reactionTime;

  // Cap it between 1s (minimum) and 14s (maximum patience for a single burst of typing)
  return Math.max(1000, Math.min(Math.floor(typeTimeMs), 14000));
}
