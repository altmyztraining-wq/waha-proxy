export function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NODE_ENV !== "production"
  ) return;

  const state = globalThis as typeof globalThis & { __campaignSchedulerStarted?: boolean };
  if (state.__campaignSchedulerStarted) return;
  state.__campaignSchedulerStarted = true;

  const baseUrl = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:3001";
  const minimumMs = Math.max(5_000, Number(process.env.CAMPAIGN_MIN_DELAY_MS ?? 30_000));
  const maximumMs = Math.max(minimumMs, Number(process.env.CAMPAIGN_MAX_DELAY_MS ?? 90_000));

  const run = async () => {
    let nextDelay = 5_000;
    try {
      const response = await fetch(`${baseUrl}/api/campaign/worker`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.processedJobId) {
        nextDelay = Math.floor(Math.random() * (maximumMs - minimumMs + 1)) + minimumMs;
      }
    } catch (error) {
      console.error("[BACKEND WORKER] Scheduler request failed.", error);
    } finally {
      setTimeout(run, nextDelay).unref();
    }
  };

  setTimeout(run, 3_000).unref();

  const runAi = async () => {
    let nextDelay = Math.floor(Math.random() * 90_001) + 30_000;
    try {
      const response = await fetch(`${baseUrl}/api/cross-talk`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 429 && data?.retryDelayMs) nextDelay = data.retryDelayMs;
      if (data?.message === "System is stopped.") nextDelay = 5_000;
    } catch (error) {
      console.error("[BACKEND AI] Scheduler request failed.", error);
      nextDelay = 15_000;
    } finally {
      setTimeout(runAi, nextDelay).unref();
    }
  };

  setTimeout(runAi, 5_000).unref();
}
