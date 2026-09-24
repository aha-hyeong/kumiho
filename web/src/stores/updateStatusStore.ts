import { create } from "zustand";
import { pluginAPI, systemAPI } from "../api/client";

interface UpdateStatus {
  hasSystemUpdate: boolean;
  hasPluginUpdate: boolean;
}

export const useUpdateStatusStore = create<UpdateStatus>(() => ({
  hasSystemUpdate: false,
  hasPluginUpdate: false,
}));

const POLL_INTERVAL = 30 * 60 * 1000;
let activeUser: string | null = null;
let generation = 0;
let lastAttempt = 0;
let inFlight: Promise<void> | null = null;
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function checkUpdateStatus() {
  if (!activeUser || inFlight || Date.now() - lastAttempt < POLL_INTERVAL) return;
  lastAttempt = Date.now();
  const requestGeneration = generation;
  inFlight = Promise.allSettled([systemAPI.getVersion(false), pluginAPI.getUpdates(false)])
    .then(([system, plugins]) => {
      if (requestGeneration !== generation) return;
      if (system.status === "fulfilled") {
        useUpdateStatusStore.setState({ hasSystemUpdate: system.value.needs_update });
      } else {
        console.error("Failed to check system update status:", system.reason);
      }
      if (plugins.status === "fulfilled") {
        useUpdateStatusStore.setState({ hasPluginUpdate: plugins.value.has_updates });
      } else {
        console.error("Failed to check plugin update status:", plugins.reason);
      }
    })
    .finally(() => {
      if (requestGeneration === generation) inFlight = null;
    });
}

// One status and polling interval for the entire SPA, not for each Header instance.
export function subscribeToAutomaticUpdates(userId: string): () => void {
  if (activeUser !== userId) {
    activeUser = userId;
    generation++;
    lastAttempt = 0;
    inFlight = null;
    useUpdateStatusStore.setState({ hasSystemUpdate: false, hasPluginUpdate: false });
  }
  subscribers++;
  if (!pollTimer) pollTimer = setInterval(checkUpdateStatus, POLL_INTERVAL);

  // Let route-critical data requests and the first paint start before badge traffic.
  const run = () => { if (activeUser === userId && subscribers > 0) checkUpdateStatus(); };
  const idleId = typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(run)
    : window.setTimeout(run, 0);

  return () => {
    if (typeof window.cancelIdleCallback === "function" && typeof window.requestIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    } else {
      window.clearTimeout(idleId);
    }
    subscribers--;
    if (subscribers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
