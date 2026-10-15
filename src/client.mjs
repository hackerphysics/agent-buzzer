import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.mjs";
import { activeChannels } from "./channels.mjs";
import { ingressDecision } from "./policy.mjs";
import { makeEntry, persistEntry } from "./queue.mjs";
import { BASE_URL } from "./service.mjs";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-buzzer.mjs");

async function health(signal) {
  const response = await fetch(`${BASE_URL}/health`, {
    headers: { Connection: "close" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(700)]),
  });
  if (!response.ok || (await response.json()).service !== "agent-buzzer") throw new Error("Port occupied by another service");
  return true;
}

export async function ensureService({ signal } = {}) {
  const startupDeadline = AbortSignal.timeout(3000);
  signal = signal ? AbortSignal.any([signal, startupDeadline]) : startupDeadline;
  try { return await health(signal); } catch { /* Start the local service below. */ }
  signal.throwIfAborted();
  const child = spawn(process.execPath, [ENTRY, "serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  child.unref();
  while (!signal.aborted) {
    await sleep(200, undefined, { signal });
    try { return await health(signal); } catch { /* Startup can race other hooks. */ }
  }
  throw new Error("AgentBuzzer service did not start");
}

export async function submitEvent(event) {
  const config = loadConfig(process.env, { includeSecret: false });
  if (ingressDecision(config.notifications, event.agent) !== "queue" || !activeChannels(config.channels).length) return { disposition: "dropped" };
  try {
    // One budget covers startup, request headers, and the complete response body.
    const signal = AbortSignal.timeout(5000);
    await ensureService({ signal });
    const response = await fetch(`${BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify(event),
      signal,
    });
    if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`);
    return await response.json();
  } catch {
    const current = loadConfig(process.env, { includeSecret: false });
    const channels = activeChannels(current.channels);
    if (ingressDecision(current.notifications, event.agent) !== "queue" || !channels.length) return { disposition: "dropped" };
    const entry = makeEntry({ ...event, deviceName: current.deviceName }, Date.now(), channels);
    persistEntry(entry);
    return { disposition: "queued_offline", id: entry.id };
  }
}
