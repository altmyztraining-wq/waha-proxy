"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SenderStatus = "ACTIVE" | "BANNED" | "RESTING" | "OFFLINE";
type MessageStatus = "SENT" | "FAILED" | "PENDING";

type WahaSession = {
  name?: string;
  status?: string;
  me?: {
    id?: string;
    pushName?: string;
  } | null;
  config?: {
    proxy?: {
      server?: string;
    };
  };
};

type WahaSender = {
  phoneNumber: string;
  sessionName: string;
  status: SenderStatus;
  dailySentCount: number;
  maxDailyLimit: number;
  warmupDay: number;
  proxyIp: string;
  lastActiveAt: string;
  createdAt: string;
  analytics?: {
    totalSent: number;
    totalFailed: number;
    successRate: number;
  };
};

type MessageLog = {
  logId: number;
  senderPhone: string;
  targetPhone: string;
  messageBody: string;
  status: MessageStatus;
  errorReason: string | null;
  createdAt: string;
};

type ActivityLog = {
  id: number;
  source: string;
  event: string;
  status: string;
  message: string;
  metadata: string | null;
  createdAt: string;
};

type ProxyTestResult = {
  success: boolean;
  proxyServer: string;
  exitIp: string;
  whatsappReachable: boolean;
  durationMs: number;
  testedAt: string;
};

type MonitorSnapshot = {
  generatedAt: string;
  configuredProxyUrl: string;
  waha: {
    version: {
      version?: string;
      engine?: string;
      tier?: string;
      browser?: string;
      platform?: string;
    };
    sessions: WahaSession[];
  };
  senders: WahaSender[];
  messageLogs: MessageLog[];
  activityLogs: ActivityLog[];
  stats: {
    messages: Record<string, number>;
    senders: Record<string, number>;
  };
};

type CampaignResponse = {
  success: boolean;
  delayMs: number;
  totalRequested: number;
  sent: number;
  failed: number;
  results: Array<{
    targetPhone: string;
    senderPhone?: string;
    status: MessageStatus;
    errorReason?: string;
  }>;
};

type Toast = {
  id: number;
  type: "success" | "error";
  message: string;
};

type CampaignJob = {
  id: number;
  targetPhone: string;
  messageBody: string;
  status: string;
  displayStatus: string;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_SESSION = "";

function Badge({ value }: { value: string }) {
  const tone =
    value === "ACTIVE" || value === "SENT" || value === "DONE" || value === "WORKING"
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
      : value === "BANNED" || value === "FAILED"
        ? "border-red-400/35 bg-red-400/10 text-red-200"
        : "border-amber-400/35 bg-amber-400/10 text-amber-100";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${tone}`}>
      {value}
    </span>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <section className="glass-card p-4">
      <p className="text-xs uppercase text-foreground/45">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-foreground/45">{helper}</p>
    </section>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}

function activityMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function FloatingActivityMonitor({ logs }: { logs: ActivityLog[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside className="fixed bottom-4 left-4 z-40 w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border border-cyan-400/25 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between border-b border-white/10 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-70" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" /></span>
          Live Activity
          <span className="font-mono text-[10px] text-foreground/40">{logs.length} events</span>
        </span>
        <span className="text-foreground/50">{expanded ? "▼" : "▲"}</span>
      </button>

      {expanded && (
        <div className="max-h-[420px] overflow-y-auto p-2">
          {logs.length === 0 ? (
            <div className="p-6 text-center text-xs text-foreground/40">Waiting for campaign or AI activity...</div>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.slice(0, 20).map((entry) => {
                const metadata = activityMetadata(entry.metadata);
                const sender = typeof metadata.senderPhone === "string" ? metadata.senderPhone : null;
                const target = typeof metadata.targetPhone === "string" ? metadata.targetPhone : null;
                const proxy = typeof metadata.proxyIp === "string" ? metadata.proxyIp : null;
                const body = typeof metadata.messageBody === "string" ? metadata.messageBody : null;
                const campaign = typeof metadata.campaignName === "string" ? metadata.campaignName : null;

                return (
                  <article key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 font-bold ${entry.source === "CROSS_TALK" ? "bg-indigo-400/15 text-indigo-300" : entry.source === "CAMPAIGN" ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-400/15 text-slate-300"}`}>{entry.source === "CROSS_TALK" ? "AI" : entry.source}</span>
                        <span className="truncate font-mono text-[10px] text-foreground/50">{entry.event}</span>
                      </div>
                      <time className="shrink-0 font-mono text-[10px] text-cyan-300">{new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour12: false })}</time>
                    </div>
                    {sender && target && <div className="mt-2 font-mono text-[11px] text-foreground/80">{sender} <span className="text-cyan-400">→</span> {target}</div>}
                    <p className="mt-1 text-foreground/65">{entry.message}</p>
                    {body && <p className="mt-1 truncate text-foreground/45" title={body}>“{body}”</p>}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-foreground/35">
                      {campaign && <span>campaign: {campaign}</span>}
                      {proxy && <span>proxy: {proxy}</span>}
                      <span className={entry.status === "FAILED" ? "text-red-300" : entry.status === "SUCCESS" ? "text-emerald-300" : ""}>{entry.status}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortText(value: string, max = 64) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatCountdown(totalSeconds: number | null) {
  if (totalSeconds === null) return "-";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function proxyServerFromUrl(value: string) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}:${url.port}`;
  } catch {
    return value.replace(/^https?:\/\//, "");
  }
}

export default function DashboardPage() {
  // QR Modal state
  const [activeQrSession, setActiveQrSession] = useState<string | null>(null);
  const [qrKey, setQrKey] = useState(0);
  const [screenshotSession, setScreenshotSession] = useState<string | null>(null);
  const [screenshotKey, setScreenshotKey] = useState(0);

  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSender, setSavingSender] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const [managingSession, setManagingSession] = useState<string | null>(null);
  const [syncingSession, setSyncingSession] = useState<string | null>(null);
  const [runningCampaign, setRunningCampaign] = useState(false);
  const [runningCrossTalk, setRunningCrossTalk] = useState(false);
  const [campaignResult, setCampaignResult] =
    useState<CampaignResponse | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "sessions" | "campaigns">("overview");

  const [autoPilot, setAutoPilot] = useState(false);

  // Campaign & Queue States
  const [queueStatus, setQueueStatus] = useState<{
    global: { PENDING: number; PROCESSING: number; DONE: number; FAILED: number; TOTAL: number };
    campaigns: Array<{ name: string; PENDING: number; PROCESSING: number; DONE: number; FAILED: number; TOTAL: number }>;
    activeCampaign: { campaignName: string; status: string } | null;
    stuckProcessing: number;
  } | null>(null);
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>("all");
  const [campaignName, setCampaignName] = useState("");
  const [campaignAutoPilot, setCampaignAutoPilot] = useState(false);
  const [resettingQueue, setResettingQueue] = useState(false);
  const [viewedCampaignName, setViewedCampaignName] = useState<string | null>(null);
  const [campaignJobs, setCampaignJobs] = useState<CampaignJob[]>([]);
  const [loadingCampaignJobs, setLoadingCampaignJobs] = useState(false);
  const [retryingFailedJobs, setRetryingFailedJobs] = useState(false);
  const [recoveringStuckJobs, setRecoveringStuckJobs] = useState(false);

  const [sessionName, setSessionName] = useState(DEFAULT_SESSION);
  const [sessionProxyUrl, setSessionProxyUrl] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderStatus, setSenderStatus] = useState<SenderStatus>("ACTIVE");
  const [maxDailyLimit, setMaxDailyLimit] = useState(20);
  const [proxyIp, setProxyIp] = useState("");
  const [targets, setTargets] = useState("");
  const [messageBody, setMessageBody] = useState("");

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now();
    setToasts((current) => [...current, { id, type, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  // QR code auto-refresh
  useEffect(() => {
    if (!activeQrSession) return;
    const interval = setInterval(() => {
      setQrKey((k) => k + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeQrSession]);

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const response = await fetch("/api/monitor", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load monitor data.");
      }

      setSnapshot(data);
      setProxyIp((current) => current || proxyServerFromUrl(data.configuredProxyUrl));
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Unable to load dashboard."
      );
    } finally {
      if (!background) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      void refresh(true);
    }, 5000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refresh]);

  // Campaign Queue Polling
  const fetchQueueStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/campaign/status");
      if (response.ok) {
        setQueueStatus(await response.json());
      }
    } catch (e) {
      // ignore silently
    }
  }, []);

  useEffect(() => {
    fetchQueueStatus();
    // Poll every 10 seconds to reduce log clutter
    const interval = setInterval(fetchQueueStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchQueueStatus]);

  async function viewCampaign(name: string) {
    setSelectedCampaignName(name);
    setViewedCampaignName(name);
    setCampaignJobs([]);
    setLoadingCampaignJobs(true);

    try {
      const response = await fetch(`/api/campaign/queue?campaignName=${encodeURIComponent(name)}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load campaign details.");
      }

      setCampaignJobs(data.jobs ?? []);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to load campaign details.");
      setViewedCampaignName(null);
    } finally {
      setLoadingCampaignJobs(false);
    }
  }

  async function retryFailedCampaignJobs() {
    if (!viewedCampaignName) return;

    const failedCount = campaignJobs.filter((job) => job.status === "FAILED").length;
    if (failedCount === 0) return;

    if (!window.confirm(`Retry all ${failedCount} failed job${failedCount === 1 ? "" : "s"} in "${viewedCampaignName}"?`)) {
      return;
    }

    setRetryingFailedJobs(true);
    try {
      const response = await fetch("/api/campaign/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignName: viewedCampaignName, action: "retry_failed" }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to retry failed jobs.");
      }

      addToast("success", `${data.retriedCount} failed job${data.retriedCount === 1 ? "" : "s"} moved back to pending.`);
      await Promise.all([fetchQueueStatus(), viewCampaign(viewedCampaignName)]);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to retry failed jobs.");
    } finally {
      setRetryingFailedJobs(false);
    }
  }

  async function recoverStuckCampaignJobs() {
    if (!viewedCampaignName) return;

    const stuckCount = campaignJobs.filter((job) => job.displayStatus === "STUCK").length;
    if (stuckCount === 0) return;

    if (!window.confirm(`Recover ${stuckCount} stuck job${stuckCount === 1 ? "" : "s"} in "${viewedCampaignName}"? It will be sent again, so a duplicate is possible if WhatsApp received it before the interruption.`)) {
      return;
    }

    setRecoveringStuckJobs(true);
    try {
      const response = await fetch("/api/campaign/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignName: viewedCampaignName, action: "recover_stuck" }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to recover stuck jobs.");
      }

      setCampaignAutoPilot(true);
      addToast("success", `${data.recoveredCount} stuck job${data.recoveredCount === 1 ? "" : "s"} moved back to pending.`);
      await Promise.all([fetchQueueStatus(), viewCampaign(viewedCampaignName)]);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Unable to recover stuck jobs.");
    } finally {
      setRecoveringStuckJobs(false);
    }
  }

  const selectedSession = useMemo(
    () =>
      snapshot?.waha.sessions.find((session) => session.name === sessionName) ??
      null,
    [snapshot, sessionName]
  );

  const targetCount = useMemo(() => {
    return Array.from(
      new Set(
        targets
          .split(/[\n,; ]+/)
          .map((target) => target.replace(/\D/g, ""))
          .filter(Boolean)
      )
    ).length;
  }, [targets]);

  async function startSession(event: React.FormEvent) {
    event.preventDefault();
    setStartingSession(true);

    try {
      const response = await fetch("/api/waha/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionName,
          proxyUrl: sessionProxyUrl || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to start session.");
      }

      addToast("success", `✅ Session created! WhatsApp sees IP: ${data.proxyExitIp ?? "verified"}`);
      await refresh();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Session start failed."
      );
    } finally {
      setStartingSession(false);
    }
  }

  async function testSessionProxy(proxyOverride?: string) {
    setTestingProxy(true);
    setProxyTestResult(null);

    try {
      const response = await fetch("/api/proxy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: proxyOverride || sessionProxyUrl || undefined }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Proxy test failed.");
      }

      setProxyTestResult(data);
      addToast("success", `Proxy is working. Exit IP: ${data.exitIp}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Proxy test failed.");
    } finally {
      setTestingProxy(false);
    }
  }

  async function manageSession(name: string, action: "start" | "stop" | "restart" | "logout" | "force_delete") {
    setManagingSession(`${name}-${action}`);
    try {
      const response = await fetch("/api/waha/session/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionName: name, action }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? `Failed to ${action} session.`);
      }

      addToast("success", `Session ${name} successfully updated.`);
      await refresh();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : `Failed to ${action} session.`
      );
    } finally {
      setManagingSession(null);
    }
  }

  async function syncSessionToDb(session: any) {
    if (!session.name || !session.me?.id) return;
    
    setSyncingSession(session.name);
    try {
      // The session.me.id usually looks like "201000000000@c.us"
      const phone = session.me.id.split("@")[0];
      const proxy = session.config?.proxy?.server ?? "";

      const response = await fetch("/api/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone,
          sessionName: session.name,
          status: "ACTIVE",
          maxDailyLimit: 50,
          proxyIp: proxy,
        }),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to sync sender.");
      }

      addToast("success", `Sender ${phone} synced to DB successfully!`);
      await refresh();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to sync sender."
      );
    } finally {
      setSyncingSession(null);
    }
  }

  async function saveSender(event: React.FormEvent) {
    event.preventDefault();
    setSavingSender(true);

    try {
      const response = await fetch("/api/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: senderPhone,
          sessionName,
          status: senderStatus,
          maxDailyLimit,
          proxyIp,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save sender.");
      }

      addToast("success", "Sender saved in SQLite.");
      await refresh();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Sender save failed."
      );
    } finally {
      setSavingSender(false);
    }
  }

  async function toggleSenderStatus(phone: string, currentStatus: string) {
    const newStatus = currentStatus === "ACTIVE" ? "RESTING" : "ACTIVE";
    try {
      const response = await fetch("/api/senders/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone, status: newStatus }),
      });
      if (!response.ok) throw new Error("Failed to toggle status");
      addToast("success", `Sender ${phone} is now ${newStatus}`);
      await refresh();
    } catch (e) {
      addToast("error", "Could not toggle sender status");
    }
  }

  async function runCampaign(event: React.FormEvent) {
    event.preventDefault();
    setRunningCampaign(true);

    try {
      const response = await fetch("/api/campaign/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPhones: targets,
          messageBody,
          campaignName: campaignName.trim() || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to queue campaign.");
      }

      addToast("success", `Added ${data.queuedCount} targets to the Campaign Queue!`);
      setTargets(""); // Clear textarea
      setCampaignName(""); // Clear campaign name input
      setCampaignAutoPilot(true);
      setAutoPilot(true);
      void fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "UNIFIED_AUTOPILOT_STARTED" }),
      });
      await fetchQueueStatus();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Campaign queue failed."
      );
    } finally {
      setRunningCampaign(false);
    }
  }

  async function resetPendingQueue() {
    const isAll = selectedCampaignName === "all";
    const confirmMessage = isAll
      ? "Are you sure you want to reset all pending jobs globally?"
      : `Are you sure you want to reset pending jobs for campaign "${selectedCampaignName}"?`;

    if (!confirm(confirmMessage)) return;
    setResettingQueue(true);
    try {
      const url = isAll
        ? "/api/campaign/queue"
        : `/api/campaign/queue?campaignName=${encodeURIComponent(selectedCampaignName)}`;

      const response = await fetch(url, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to reset pending queue.");
      }
      addToast("success", `Successfully reset/removed ${data.deletedCount} pending jobs.`);
      await fetchQueueStatus();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to reset pending queue."
      );
    } finally {
      setResettingQueue(false);
    }
  }

  async function triggerCrossTalk() {
    setRunningCrossTalk(true);
    try {
      const response = await fetch("/api/cross-talk?manual=true", { method: "POST" });
      const data = await response.json();

      if (response.status === 429 && data.retryDelayMs) {
        addToast("error", `API Rate Limit! Pausing AI Chat for ${Math.ceil(data.retryDelayMs / 1000)}s...`);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Cross-talk failed.");
      }

      addToast("success", `AI Chat successful between ${data.conversation[0].from} and ${data.conversation[1].from}!`);
      await refresh();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Cross-talk failed."
      );
    } finally {
      setRunningCrossTalk(false);
    }
  }

  function toggleUnifiedAutoPilot() {
    const shouldStart = !(autoPilot && campaignAutoPilot);
    setAutoPilot(shouldStart);
    setCampaignAutoPilot(shouldStart);
    void fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: shouldStart ? "UNIFIED_AUTOPILOT_STARTED" : "UNIFIED_AUTOPILOT_STOPPED",
      }),
    });
    addToast(
      "success",
      shouldStart
        ? "Unified Auto-Pilot started: campaigns and AI cross-talk are active."
        : "Unified Auto-Pilot stopped."
    );
  }

  const messageStats = snapshot?.stats.messages ?? {};
  const senderStats = snapshot?.stats.senders ?? {};
  const sessions = snapshot?.waha.sessions ?? [];
  const senders = snapshot?.senders ?? [];
  const logs = snapshot?.messageLogs ?? [];
  const activityLogs = snapshot?.activityLogs ?? [];
  const activeCampaignMetrics = queueStatus?.activeCampaign
    ? queueStatus.campaigns.find((campaign) => campaign.name === queueStatus.activeCampaign?.campaignName) ?? null
    : null;

  return (
    <main className="min-h-screen bg-mesh px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 lg:flex-row lg:items-start">
        
        {/* Sidebar Navigation */}
        <aside className="glass-card flex w-full flex-col gap-2 p-5 lg:sticky lg:top-8 lg:w-72">
          <div className="mb-8 px-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-accent">WAHA Proxy</p>
            <h1 className="text-gradient mt-1 text-2xl font-black tracking-tight">
              Control Room
            </h1>
            <p className="mt-2 text-xs text-foreground/50">
              Premium WhatsApp Anti-Ban System
            </p>
          </div>
          
          <nav className="flex flex-col gap-2">
            <button 
              onClick={() => setActiveTab("overview")} 
              className={`w-full text-left ${activeTab === "overview" ? "tab-btn-active" : "tab-btn"}`}
            >
              <span className="mr-3">📊</span> Overview
            </button>
            <button 
              onClick={() => setActiveTab("sessions")} 
              className={`w-full text-left ${activeTab === "sessions" ? "tab-btn-active" : "tab-btn"}`}
            >
              <span className="mr-3">📱</span> Sessions
            </button>
            <button 
              onClick={() => setActiveTab("campaigns")} 
              className={`w-full text-left ${activeTab === "campaigns" ? "tab-btn-active" : "tab-btn"}`}
            >
              <span className="mr-3">🚀</span> Campaigns & AI
            </button>
          </nav>

          <div className="mt-auto pt-10">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-center text-xs text-emerald-200/80">
                WAHA sessions are managed here. Direct engine access is not required.
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                className="btn-primary text-sm"
                disabled={loading}
              >
                {loading ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex w-full flex-col gap-6">
          
          {/* ======================= OVERVIEW TAB ======================= */}
          {activeTab === "overview" && (
            <div className="fade-in flex flex-col gap-6">
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Active senders"
                  value={senderStats.ACTIVE ?? 0}
                  helper={`${senderStats.BANNED ?? 0} banned, ${senderStats.RESTING ?? 0} resting`}
                />
                <StatCard
                  label="Messages sent"
                  value={messageStats.SENT ?? 0}
                  helper={`${messageStats.FAILED ?? 0} failed`}
                />
                <StatCard
                  label="Sessions"
                  value={sessions.length}
                  helper={snapshot ? `Updated ${formatDate(snapshot.generatedAt)}` : "-"}
                />
                <StatCard
                  label="WAHA engine"
                  value={snapshot?.waha.version.engine ?? "-"}
                  helper={snapshot?.waha.version.browser ?? "Waiting for WAHA"}
                />
              </section>

              <section className="glass-card overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <h2 className="text-lg font-semibold text-foreground">Recent Message Logs</h2>
                  <p className="mt-1 text-sm text-foreground/50">
                    Last 50 records from local SQLite.
                  </p>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Sender</th>
                        <th>Target</th>
                        <th>Status</th>
                        <th>Message</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center">No message logs yet.</td>
                        </tr>
                      ) : (
                        logs.map((log) => (
                          <tr key={log.logId} className="hover:bg-white/5 transition-colors">
                            <td className="whitespace-nowrap text-xs text-foreground/70">{formatDate(log.createdAt)}</td>
                            <td className="font-mono text-xs">{log.senderPhone}</td>
                            <td className="font-mono text-xs">{log.targetPhone}</td>
                            <td><Badge value={log.status} /></td>
                            <td className="max-w-xs truncate" title={log.messageBody}>{shortText(log.messageBody, 40)}</td>
                            <td className="text-xs text-red-300">{log.errorReason ? shortText(log.errorReason, 40) : "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="glass-card overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <h2 className="text-lg font-semibold text-foreground">Activity Audit Log</h2>
                  <p className="mt-1 text-sm text-foreground/50">
                    Campaign and AI activity persisted in SQLite. Refreshes automatically every 5 seconds.
                  </p>
                </div>
                <div className="table-scroll max-h-[520px] overflow-auto">
                  <table className="data-table">
                    <thead className="sticky top-0 z-10 bg-slate-950">
                      <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Event</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.length === 0 ? (
                        <tr><td colSpan={5} className="text-center">No activity recorded yet.</td></tr>
                      ) : (
                        activityLogs.map((entry) => (
                          <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                            <td className="whitespace-nowrap text-xs text-foreground/70">{formatDate(entry.createdAt)}</td>
                            <td className="font-mono text-xs">{entry.source}</td>
                            <td className="font-mono text-xs">{entry.event}</td>
                            <td><Badge value={entry.status} /></td>
                            <td className="max-w-xl text-xs" title={entry.message}>{entry.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* ======================= SESSIONS TAB ======================= */}
          {activeTab === "sessions" && (
            <div className="fade-in flex flex-col gap-6">

              {/* Create Session Form */}
              <section className="glass-card p-6 bg-gradient-to-r from-blue-900/10 to-indigo-900/10 border-blue-500/20">
                <div className="border-b border-white/10 pb-4 mb-5">
                  <h2 className="text-lg font-semibold text-foreground">Create WAHA Session</h2>
                  <p className="mt-1 text-xs text-foreground/50">Register and configure a new WhatsApp WebJS container.</p>
                </div>
                <form onSubmit={startSession} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] items-end gap-4">
                  <div>
                    <label className="field-label" htmlFor="newSessionName">Session Name</label>
                    <input
                      id="newSessionName"
                      type="text"
                      className="input-field"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="e.g. session_01"
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="newSessionProxy">Proxy URL (Optional)</label>
                    <input
                      id="newSessionProxy"
                      type="text"
                      className="input-field font-mono text-xs"
                      value={sessionProxyUrl}
                      onChange={(e) => { setSessionProxyUrl(e.target.value); setProxyTestResult(null); }}
                      placeholder="http://user:pass@ip:port"
                    />
                    {proxyTestResult && (
                      <p className="mt-2 text-xs text-emerald-300">
                        Exit IP: <span className="font-mono font-bold">{proxyTestResult.exitIp}</span>
                        {` · ${proxyTestResult.durationMs}ms · WhatsApp reachable`}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void testSessionProxy()}
                    disabled={testingProxy}
                    className="btn-secondary py-2.5 px-5 whitespace-nowrap h-[42px] flex items-center justify-center gap-2"
                  >
                    {testingProxy ? (
                      <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Testing...</>
                    ) : "Test Proxy"}
                  </button>
                  <button
                    type="submit"
                    disabled={startingSession}
                    className="btn-primary py-2.5 px-6 whitespace-nowrap h-[42px] flex items-center justify-center gap-2"
                  >
                    {startingSession ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Creating...
                      </>
                    ) : (
                      "Create Session"
                    )}
                  </button>
                </form>
              </section>

              <section className="glass-card overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <h2 className="text-lg font-semibold text-foreground">WAHA Sessions (Engines)</h2>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Proxy</th>
                        <th>Account</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.length === 0 ? (
                        <tr><td colSpan={5} className="text-center">No WAHA sessions found.</td></tr>
                      ) : (
                        sessions.map((session) => (
                          <tr key={session.name ?? "unknown"} className="hover:bg-white/5 transition-colors">
                            <td className="font-mono">{session.name ?? "-"}</td>
                            <td><Badge value={session.status ?? "UNKNOWN"} /></td>
                            <td className="font-mono text-xs text-foreground/70">{session.config?.proxy?.server ?? "NO_PROXY"}</td>
                            <td className="font-mono text-xs">{session.me?.id ?? "-"}</td>
                            <td>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* QR Scan button - show when session needs QR */}
                                {(session.status === "SCAN_QR_CODE" || session.status === "FAILED") && (
                                  <button
                                    onClick={() => { setActiveQrSession(session.name ?? null); setQrKey(0); }}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded border border-blue-500/30 transition-colors"
                                  >
                                    Scan QR
                                  </button>
                                )}
                                {/* Start button - when stopped */}
                                {(session.status === "STOPPED" || session.status === "FAILED") && (
                                  <button
                                    onClick={() => manageSession(session.name!, "start")}
                                    disabled={managingSession === `${session.name}-start`}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded border border-emerald-500/30 transition-colors disabled:opacity-40"
                                  >
                                    {managingSession === `${session.name}-start` ? "..." : "Start"}
                                  </button>
                                )}
                                {/* Stop button - when working/active */}
                                {(session.status === "WORKING" || session.status === "SCAN_QR_CODE") && (
                                  <button
                                    onClick={() => manageSession(session.name!, "stop")}
                                    disabled={managingSession === `${session.name}-stop`}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded border border-amber-500/30 transition-colors disabled:opacity-40"
                                  >
                                    {managingSession === `${session.name}-stop` ? "..." : "Stop"}
                                  </button>
                                )}
                                <button
                                  onClick={() => { if (confirm(`Restart session "${session.name}"?`)) void manageSession(session.name!, "restart"); }}
                                  disabled={managingSession === `${session.name}-restart`}
                                  className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded border border-sky-500/30 transition-colors disabled:opacity-40"
                                >
                                  {managingSession === `${session.name}-restart` ? "..." : "Restart"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setScreenshotSession(session.name ?? null); setScreenshotKey((key) => key + 1); }}
                                  className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded border border-indigo-500/30 transition-colors"
                                >
                                  Screenshot
                                </button>
                                {/* Sync to DB - when session has a connected account */}
                                {session.me?.id && (
                                  <button
                                    onClick={() => syncSessionToDb(session)}
                                    disabled={syncingSession === session.name}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded border border-purple-500/30 transition-colors disabled:opacity-40"
                                  >
                                    {syncingSession === session.name ? "..." : "Sync DB"}
                                  </button>
                                )}
                                {session.config?.proxy?.server && (
                                  <button
                                    type="button"
                                    onClick={() => void testSessionProxy(session.config?.proxy?.server)}
                                    disabled={testingProxy}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded border border-cyan-500/30 transition-colors disabled:opacity-40"
                                  >
                                    {testingProxy ? "Testing..." : "Test Proxy"}
                                  </button>
                                )}
                                {session.me?.id && (
                                  <button
                                    onClick={() => { if (confirm(`Log out WhatsApp from session "${session.name}"? A new QR scan will be required.`)) void manageSession(session.name!, "logout"); }}
                                    disabled={managingSession === `${session.name}-logout`}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded border border-orange-500/30 transition-colors disabled:opacity-40"
                                  >
                                    {managingSession === `${session.name}-logout` ? "..." : "Logout"}
                                  </button>
                                )}
                                {/* Delete button */}
                                <button
                                  onClick={() => { if (confirm(`Delete session "${session.name}"? This will log out the WhatsApp account.`)) manageSession(session.name!, "force_delete"); }}
                                  disabled={managingSession === `${session.name}-force_delete`}
                                  className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded border border-red-500/30 transition-colors disabled:opacity-40"
                                >
                                  {managingSession === `${session.name}-force_delete` ? "..." : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="glass-card overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <h2 className="text-lg font-semibold text-foreground">Sender Analytics Registry</h2>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Phone</th>
                        <th>Status</th>
                        <th>Today</th>
                        <th>Lifetime</th>
                        <th>Failed</th>
                        <th>Success Rate</th>
                        <th>Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {senders.length === 0 ? (
                        <tr><td colSpan={7} className="text-center">No senders saved yet.</td></tr>
                      ) : (
                        senders.map((sender) => (
                          <tr key={sender.phoneNumber} className="hover:bg-white/5 transition-colors">
                            <td className="font-mono text-sm">{sender.phoneNumber}</td>
                            <td className="flex items-center gap-2">
                              <Badge value={sender.status} />
                              <button 
                                onClick={() => toggleSenderStatus(sender.phoneNumber, sender.status)}
                                className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors"
                              >
                                {sender.status === "ACTIVE" ? "Pause" : "Resume"}
                              </button>
                            </td>
                            <td className="font-mono text-sm">
                              {sender.dailySentCount} <span className="text-foreground/40">/ {sender.maxDailyLimit}</span>
                            </td>
                            <td className="font-mono text-sm">{sender.analytics?.totalSent ?? 0}</td>
                            <td className="font-mono text-sm text-red-400">{sender.analytics?.totalFailed ?? 0}</td>
                            <td>
                              <span className={`text-sm font-bold ${
                                (sender.analytics?.successRate ?? 0) >= 90 ? "text-emerald-400" : "text-amber-400"
                              }`}>
                                {sender.analytics?.successRate ?? 0}%
                              </span>
                            </td>
                            <td className="text-xs text-foreground/60 whitespace-nowrap">
                              {new Date(sender.lastActiveAt).toLocaleString("en-US", {
                                hour: "numeric", minute: "numeric", day: "numeric", month: "short"
                              })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* ======================= CAMPAIGNS TAB ======================= */}
          {activeTab === "campaigns" && (
            <div className="fade-in flex flex-col gap-6">

              <section className="glass-card flex flex-col gap-5 border-emerald-400/30 bg-gradient-to-r from-emerald-900/20 via-cyan-900/10 to-indigo-900/20 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-black text-foreground">System Control</h2>
                    {autoPilot && campaignAutoPilot && (
                      <span className="flex h-3 w-3 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 max-w-2xl text-sm text-foreground/60">
                    One control for campaign delivery and AI pair conversations. Add a campaign and the system starts automatically.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className={`rounded border px-2 py-1 ${campaignAutoPilot ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-foreground/50"}`}>
                      Campaign: {campaignAutoPilot ? "RUNNING" : "STOPPED"}
                    </span>
                    <span className={`rounded border px-2 py-1 ${autoPilot ? "border-indigo-400/30 bg-indigo-400/10 text-indigo-200" : "border-white/10 bg-white/5 text-foreground/50"}`}>
                      AI Pairs: {autoPilot ? "RUNNING" : "STOPPED"}
                    </span>
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-foreground/60">
                      Queue: {queueStatus?.global?.PENDING ?? 0} pending
                    </span>
                    {(queueStatus?.stuckProcessing ?? 0) > 0 && (
                      <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200">
                        {queueStatus?.stuckProcessing} old stuck record
                      </span>
                    )}
                    {autoPilot && (
                      <span className="rounded border border-indigo-400/20 bg-indigo-400/5 px-2 py-1 font-mono text-indigo-200">
                        {runningCrossTalk ? "Manual AI conversation active" : "Backend AI scheduler active"}
                      </span>
                    )}
                    {campaignAutoPilot && (queueStatus?.global.PROCESSING ?? 0) > 0 && (
                      <span className="rounded border border-emerald-400/20 bg-emerald-400/5 px-2 py-1 font-mono text-emerald-200">Backend worker is processing...</span>
                    )}
                  </div>
                  <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
                    {queueStatus?.activeCampaign && activeCampaignMetrics ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Active Campaign</p>
                            <p className="mt-1 truncate text-sm font-bold text-foreground" title={queueStatus.activeCampaign.campaignName}>{queueStatus.activeCampaign.campaignName}</p>
                          </div>
                          <Badge value={queueStatus.activeCampaign.status === "PROCESSING" ? "SENDING" : "QUEUED"} />
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${activeCampaignMetrics.TOTAL > 0 ? Math.round((activeCampaignMetrics.DONE / activeCampaignMetrics.TOTAL) * 100) : 0}%` }} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-foreground/50">
                          <span>{activeCampaignMetrics.DONE}/{activeCampaignMetrics.TOTAL} sent</span>
                          <span>{activeCampaignMetrics.PENDING} pending</span>
                          <span className={activeCampaignMetrics.FAILED > 0 ? "text-red-300" : ""}>{activeCampaignMetrics.FAILED} failed</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-foreground/45">No active campaign. Add targets below to start.</p>
                    )}
                  </div>
                  <details className="mt-4 text-xs text-foreground/60">
                    <summary className="cursor-pointer select-none font-semibold hover:text-foreground">Advanced Controls</summary>
                    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setCampaignAutoPilot((value) => !value)} className="btn-secondary px-3 py-2 text-xs">{campaignAutoPilot ? "Stop Campaign Only" : "Start Campaign Only"}</button>
                        <button type="button" onClick={() => setAutoPilot((value) => !value)} className="btn-secondary px-3 py-2 text-xs">{autoPilot ? "Stop AI Only" : "Start AI Only"}</button>
                        <button type="button" onClick={() => void triggerCrossTalk()} disabled={runningCrossTalk || autoPilot || (snapshot?.stats.senders.ACTIVE ?? 0) < 2} className="btn-secondary px-3 py-2 text-xs disabled:opacity-40">{runningCrossTalk ? "AI Chat Running..." : "Run One AI Chat"}</button>
                      </div>
                      <p className="mt-3 border-t border-white/10 pt-3 text-foreground/50">Campaign and customer replies run in the backend even when this page is closed. Backend delay: 30–90 seconds.</p>
                    </div>
                  </details>
                </div>
                <button
                  type="button"
                  onClick={toggleUnifiedAutoPilot}
                  className={`min-w-52 rounded-lg px-6 py-3 text-sm font-bold text-white shadow-xl transition-colors ${
                    autoPilot && campaignAutoPilot
                      ? "bg-red-500 hover:bg-red-600 shadow-red-500/20"
                      : "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                  }`}
                >
                  {autoPilot && campaignAutoPilot ? "Stop System" : "Start System"}
                </button>
              </section>
              
              <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_350px]">
                <div className="flex flex-col gap-6">
                  <form onSubmit={runCampaign} className="glass-card p-6 flex flex-col gap-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-white/10 pb-4">
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">Campaign Queue Manager</h2>
                        <p className="mt-1 text-sm text-foreground/50">
                          Add targets to the queue. System Control processes them automatically in the background.
                        </p>
                      </div>
                      <Badge value={`${targetCount} Targets`} />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="campaignNameInput">Campaign Label / Name (Optional)</label>
                      <input
                        id="campaignNameInput"
                        type="text"
                        className="input-field"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="e.g. Biology Batch A Reminder"
                      />
                    </div>

                    <div>
                      <label className="field-label" htmlFor="targets">Target Phones (One per line)</label>
                      <textarea
                        id="targets"
                        className="input-field min-h-[140px] resize-y font-mono text-sm leading-relaxed"
                        value={targets}
                        onChange={(event) => setTargets(event.target.value)}
                        placeholder={"201000000001\n201000000002"}
                      />
                    </div>
                    
                    <div>
                      <label className="field-label" htmlFor="message">Message Body (Spintax Supported)</label>
                      <textarea
                        id="message"
                        className="input-field min-h-[140px] resize-y leading-relaxed"
                        value={messageBody}
                        onChange={(event) => setMessageBody(event.target.value)}
                        placeholder="Hello {Ali|Ahmed}, this is a reminder to pay your {fees|dues}."
                      />
                    </div>

                    <button className="btn-primary mt-2 text-lg py-3" type="submit" disabled={runningCampaign}>
                      {runningCampaign ? "Adding & Starting..." : "Add Campaign & Start System"}
                    </button>
                  </form>

                  {/* Campaigns Overview List */}
                  <section className="glass-card overflow-hidden">
                    <div className="border-b border-white/10 p-5 bg-slate-900/40">
                      <h2 className="text-lg font-semibold text-foreground">Active Campaigns Overview</h2>
                      <p className="mt-1 text-xs text-foreground/50">List of all batches currently in the queue registry.</p>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table text-xs">
                        <thead>
                          <tr>
                            <th>Campaign Name</th>
                            <th>Pending</th>
                            <th>Sent</th>
                            <th>Failed</th>
                            <th>Total</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!queueStatus?.campaigns || queueStatus.campaigns.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="text-center text-foreground/40">No campaigns found in queue.</td>
                            </tr>
                          ) : (
                            queueStatus.campaigns.map((c) => (
                              <tr key={c.name} className="hover:bg-white/5 transition-colors">
                                <td className="font-semibold text-foreground max-w-[160px] truncate" title={c.name}>{c.name}</td>
                                <td className="font-mono text-emerald-400 font-bold">{c.PENDING}</td>
                                <td className="font-mono text-blue-400">{c.DONE}</td>
                                <td className="font-mono text-red-400">{c.FAILED}</td>
                                <td className="font-mono font-bold">{c.TOTAL}</td>
                                <td>
                                  <button
                                    onClick={() => void viewCampaign(c.name)}
                                    className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 transition-colors"
                                  >
                                    View
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <div className="flex flex-col gap-6">
                  {/* Queue Status Card */}
                  <div className="glass-card p-6 border-emerald-500/20 bg-gradient-to-b from-emerald-900/10 to-transparent">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        Queue Metrics
                        {(queueStatus?.global.PROCESSING ?? 0) > 0 && <span className="flex h-2 w-2 relative ml-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>}
                      </h2>
                      <select
                        value={selectedCampaignName}
                        onChange={(e) => setSelectedCampaignName(e.target.value)}
                        className="bg-slate-900 border border-white/10 text-xs text-foreground/80 rounded px-2.5 py-1.5 outline-none max-w-[180px] truncate cursor-pointer hover:border-accent transition-colors"
                      >
                        <option value="all">Global (All)</option>
                        {queueStatus?.campaigns?.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    {(() => {
                      const activeMetrics = selectedCampaignName === "all"
                        ? queueStatus?.global
                        : queueStatus?.campaigns?.find((c) => c.name === selectedCampaignName) ?? { PENDING: 0, DONE: 0, FAILED: 0, TOTAL: 0 };

                      return (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-emerald-400 font-semibold mb-1 uppercase tracking-wider">Pending</div>
                            <div className="text-2xl font-mono text-white">{activeMetrics?.PENDING ?? 0}</div>
                          </div>
                          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-blue-400 font-semibold mb-1 uppercase tracking-wider">Sent</div>
                            <div className="text-2xl font-mono text-white">{activeMetrics?.DONE ?? 0}</div>
                          </div>
                          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-red-400 font-semibold mb-1 uppercase tracking-wider">Failed</div>
                            <div className="text-2xl font-mono text-white">{activeMetrics?.FAILED ?? 0}</div>
                          </div>
                          <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-purple-400 font-semibold mb-1 uppercase tracking-wider">Total</div>
                            <div className="text-2xl font-mono text-white">{activeMetrics?.TOTAL ?? 0}</div>
                          </div>
                        </div>
                      );
                    })()}

                    <button
                      onClick={resetPendingQueue}
                      disabled={resettingQueue || ((selectedCampaignName === "all" ? queueStatus?.global?.PENDING : queueStatus?.campaigns?.find(c => c.name === selectedCampaignName)?.PENDING) ?? 0) === 0}
                      className="w-full mt-4 py-2.5 px-4 text-xs font-bold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg transition-all duration-200 disabled:opacity-30 disabled:hover:bg-red-500/20 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {resettingQueue ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-red-300 border-t-transparent" />
                          Resetting...
                        </>
                      ) : selectedCampaignName === "all" ? (
                        "Reset All Pending"
                      ) : (
                        `Reset Pending for "${shortText(selectedCampaignName, 18)}"`
                      )}
                    </button>
                  </div>

                </div>

                <div className="glass-card flex flex-col overflow-hidden">
                  <div className="border-b border-white/10 p-5 bg-slate-900/40">
                    <h2 className="text-lg font-semibold text-foreground">Latest Run Results</h2>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    {!campaignResult ? (
                      <div className="flex-1 flex items-center justify-center text-center text-foreground/40 text-sm">
                        Run a batch to see results here.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4 h-full">
                        <div className="grid grid-cols-2 gap-3">
                          <StatCard label="Sent" value={campaignResult.sent} helper="Success" />
                          <StatCard label="Failed" value={campaignResult.failed} helper="Error" />
                        </div>
                        <div className="table-scroll flex-1 mt-2">
                          <table className="data-table w-full text-xs">
                            <thead>
                              <tr>
                                <th>Target</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {campaignResult.results.map((result) => (
                                <tr key={`${result.targetPhone}-${result.senderPhone ?? "none"}`}>
                                  <td className="font-mono text-xs">{result.targetPhone}</td>
                                  <td><Badge value={result.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

        </div>
      </div>

      {/* Campaign Details Modal */}
      {viewedCampaignName && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setViewedCampaignName(null)}
        >
          <section
            className="glass-card flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 bg-slate-900/40">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-foreground">Campaign Details</h2>
                <p className="mt-1 truncate text-sm text-foreground/60" title={viewedCampaignName}>
                  {viewedCampaignName}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close campaign details"
                onClick={() => setViewedCampaignName(null)}
                className="text-2xl leading-none text-foreground/50 transition-colors hover:text-foreground"
              >
                ×
              </button>
            </div>

            <div className="table-scroll min-h-0 flex-1 overflow-auto">
              {loadingCampaignJobs ? (
                <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-foreground/60">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
                  Loading campaign details...
                </div>
              ) : campaignJobs.length === 0 ? (
                <div className="flex min-h-52 items-center justify-center text-sm text-foreground/50">
                  No jobs found for this campaign.
                </div>
              ) : (
                <table className="data-table w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-950">
                    <tr>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Message</th>
                      <th>Error</th>
                      <th>Created</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="whitespace-nowrap font-mono">{job.targetPhone}</td>
                        <td><Badge value={job.displayStatus ?? job.status} /></td>
                        <td className="max-w-64" title={job.messageBody}>{shortText(job.messageBody, 80)}</td>
                        <td className="max-w-56 text-red-300" title={job.errorReason ?? undefined}>
                          {job.errorReason ? shortText(job.errorReason, 70) : "-"}
                        </td>
                        <td className="whitespace-nowrap text-foreground/70">{formatDate(job.createdAt)}</td>
                        <td className="whitespace-nowrap text-foreground/70">{formatDate(job.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4 text-xs text-foreground/50">
              <span>{campaignJobs.length} job{campaignJobs.length === 1 ? "" : "s"}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void recoverStuckCampaignJobs()}
                  disabled={recoveringStuckJobs || campaignJobs.every((job) => job.displayStatus !== "STUCK")}
                  className="rounded-lg border border-orange-400/30 bg-orange-400/10 px-4 py-2 font-bold text-orange-200 transition-colors hover:bg-orange-400/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {recoveringStuckJobs
                    ? "Recovering..."
                    : `Recover Stuck (${campaignJobs.filter((job) => job.displayStatus === "STUCK").length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void retryFailedCampaignJobs()}
                  disabled={retryingFailedJobs || campaignJobs.every((job) => job.status !== "FAILED")}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 font-bold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {retryingFailedJobs
                    ? "Retrying..."
                    : `Retry All Failed (${campaignJobs.filter((job) => job.status === "FAILED").length})`}
                </button>
                <button type="button" onClick={() => setViewedCampaignName(null)} className="btn-secondary px-4 py-2">
                  Close
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* QR Code Modal */}
      {activeQrSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setActiveQrSession(null)}>
          <div className="glass-card p-6 max-w-md w-full mx-4 relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Scan QR Code</h3>
                <p className="text-xs text-foreground/50 font-mono mt-1">{activeQrSession}</p>
              </div>
              <button
                onClick={() => setActiveQrSession(null)}
                className="text-foreground/50 hover:text-foreground text-2xl leading-none transition-colors"
              >
                ×
              </button>
            </div>
            <div className="bg-white rounded-lg p-4 flex items-center justify-center min-h-[280px]">
              <img
                key={qrKey}
                src={`/api/waha/qr/${encodeURIComponent(activeQrSession)}?t=${qrKey}`}
                alt="WhatsApp QR Code"
                className="max-w-full max-h-[260px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.innerHTML = '<p style="color:#666;font-size:14px;text-align:center;">QR not available yet.<br/>Start the session first, then click Scan QR.</p>';
                }}
              />
            </div>
            <p className="text-xs text-foreground/40 text-center mt-3 animate-pulse">Auto-refreshing every 5 seconds...</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setQrKey((k) => k + 1)}
                className="btn-secondary flex-1 text-sm py-2"
              >
                Refresh Now
              </button>
              <button
                onClick={() => { setActiveQrSession(null); void refresh(); }}
                className="btn-primary flex-1 text-sm py-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live WAHA browser screenshot */}
      {screenshotSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setScreenshotSession(null)}>
          <div className="glass-card w-full max-w-6xl p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Session Browser Screenshot</h3>
                <p className="mt-1 font-mono text-xs text-foreground/50">{screenshotSession}</p>
              </div>
              <button type="button" onClick={() => setScreenshotSession(null)} className="text-2xl text-foreground/50 hover:text-foreground">×</button>
            </div>
            <div className="flex min-h-[320px] max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-black/40 p-2">
              <img
                key={screenshotKey}
                src={`/api/waha/screenshot/${encodeURIComponent(screenshotSession)}?t=${screenshotKey}`}
                alt={`WAHA browser screen for ${screenshotSession}`}
                className="max-h-[68vh] max-w-full object-contain"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setScreenshotKey((key) => key + 1)} className="btn-secondary px-4 py-2 text-sm">Refresh Screenshot</button>
              <button type="button" onClick={() => setScreenshotSession(null)} className="btn-primary px-4 py-2 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}

      <FloatingActivityMonitor logs={activityLogs} />

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
    </main>
  );
}
