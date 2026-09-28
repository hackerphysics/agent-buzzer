import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { activeChannels } from "./channels.mjs";
import { ingressDecision } from "./policy.mjs";
import { makeEntry, persistEntry } from "./queue.mjs";
import { BASE_URL } from "./service.mjs";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-buzzer.mjs");

async function health() {
  const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(700) });
  if (!response.ok || (await response.json()).service !== "agent-buzzer") throw new Error("Port occupied by another service");
  return true;
}

export async function ensureService() {
  try { return await health(); } catch { /* Start the local service below. */ }
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
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    try { return await health(); } catch { /* Startup can race other hooks. */ }
  }
  throw new Error("AgentBuzzer service did not start");
}

export async function submitEvent(event) {
  const config = loadConfig();
  if (ingressDecision(config.notifications, event.agent) !== "queue" || !activeChannels(config.channels).length) return { disposition: "dropped" };
  try {
    await ensureService();
    const response = await fetch(`${BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`);
    return response.json();
  } catch {
    const current = loadConfig();
    const channels = activeChannels(current.channels);
    if (ingressDecision(current.notifications, event.agent) !== "queue" || !channels.length) return { disposition: "dropped" };
    const entry = makeEntry(event, Date.now(), channels);
    persistEntry(entry);
    return { disposition: "queued_offline", id: entry.id };
  }
}
