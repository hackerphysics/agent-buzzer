import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { AGENTS, CHANNELS, loadConfig, readSettings, saveSettings } from "./config.mjs";
import { activeChannels, sendChannel, validateEndpoint } from "./channels.mjs";
import { advanceCycle, deliveryDecision, ingressDecision, resetBreak, validateNotifications } from "./policy.mjs";
import { dataPath, listEntries, makeEntry, persistEntry, purgeDisabled, removeEntry, updateEntry } from "./queue.mjs";
import { saveSecret } from "./secret-store.mjs";
import { buildId } from "./build-id.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const BUILD_ID = buildId(ROOT);
export const PORT = Number(process.env.AGENTBUZZER_PORT || 38147);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const UI_FILES = new Map([["/", "ui.html"], ["/ui.css", "ui.css"], ["/ui.js", "ui.js"]]);

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}

async function body(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("JSON request required");
  let input = "";
  for await (const chunk of request) {
    input += chunk;
    if (input.length > 65536) throw new Error("Request is too large");
  }
  return JSON.parse(input || "{}");
}

function readCycle(env) {
  try { return JSON.parse(readFileSync(dataPath("cycle.json", env), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function writeCycle(state, env) {
  const path = dataPath("cycle.json", env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx", flush: true });
  renameSync(temporary, path);
}

function safeSettings(env) {
  const config = loadConfig(env);
  return {
    deviceName: config.deviceName,
    notifications: config.notifications,
    channels: {
      feishu: {
        enabled: config.channels.feishu.enabled,
        appId: config.feishu.appId || "", receiveId: config.feishu.receiveId || "",
        receiveIdType: config.feishu.receiveIdType,
        secretConfigured: Boolean(config.feishu.appSecret),
      },
      webhook: { enabled: config.channels.webhook.enabled, urlConfigured: Boolean(config.channels.webhook.url) },
      slack: { enabled: config.channels.slack.enabled, urlConfigured: Boolean(config.channels.slack.url) },
    },
  };
}

function runCommand(program, args, timeout = 120000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { windowsHide: true, shell: process.platform === "win32" && program !== process.execPath, cwd: ROOT, env: { ...process.env, AGENTBUZZER_NODE: process.execPath } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; output = output.slice(-10000); });
    child.stderr.on("data", (chunk) => { output += chunk; output = output.slice(-10000); });
    child.once("error", reject);
    const timer = setTimeout(() => child.kill(), timeout);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else reject(new Error(output.trim().slice(-800) || `${program} exited with code ${code}`));
    });
  });
}

async function adapterStatus() {
  const results = {};
  for (const [agent, program, args] of [
    ["codex", "codex", ["plugin", "list", "--json"]],
    ["copilot", "copilot", ["plugin", "list", "--json"]],
  ]) {
    try {
      const list = JSON.parse(await runCommand(program, args, 6000));
      results[agent] = { available: true, installed: agent === "codex"
        ? Boolean(list.installed?.some((item) => item.pluginId === "agent-buzzer@agent-buzzer-local"))
        : Boolean(list.some((item) => item.name === "agent-buzzer" && item.enabled !== false)) };
    } catch {
      results[agent] = { available: false, installed: false };
    }
  }
  const home = process.env.HERMES_HOME || join(homedir(), ".hermes");
  let hermesAvailable = false;
  try { await runCommand("hermes", ["--version"], 6000); hermesAvailable = true; } catch { /* CLI not installed. */ }
  results.hermes = { available: hermesAvailable, installed: existsSync(join(home, "plugins", "agent-buzzer", "plugin.yaml")) };
  return results;
}

export function createService({ env = process.env, deliver = sendChannel, now = () => new Date(), intervalMs = 1000 } = {}) {
  let cycle = readCycle(env);
  let working = false;
  let closing = false;
  let tickTimer;
  let statusCache = { time: 0, value: null };

  function syncCycle() {
    const next = advanceCycle(loadConfig(env).notifications.cycle, cycle, now().getTime());
    if (next.phase !== cycle?.phase || next.until !== cycle?.until) {
      cycle = next;
      writeCycle(cycle, env);
    }
  }

  async function pump() {
    if (working || closing) return;
    working = true;
    try {
      syncCycle();
      for (const entry of listEntries(env)) {
        const config = loadConfig(env);
        const decision = deliveryDecision(config.notifications, entry.event.agent, cycle.phase, now());
        if (decision === "drop") { removeEntry(entry); continue; }
        if (decision === "wait" || entry.nextAttemptAt > now().getTime()) continue;
        entry.pendingChannels ||= activeChannels(config.channels);
        for (const channel of [...entry.pendingChannels]) {
          if (!config.channels[channel]?.enabled) {
            entry.pendingChannels = entry.pendingChannels.filter((name) => name !== channel);
            updateEntry(entry);
            continue;
          }
          try {
            await deliver(channel, config.channels[channel], entry.event, config.deviceName);
            entry.pendingChannels = entry.pendingChannels.filter((name) => name !== channel);
            updateEntry(entry);
          } catch (error) {
            entry.attempts++;
            entry.nextAttemptAt = now().getTime() + Math.min(300000, 2000 * 2 ** Math.min(entry.attempts - 1, 8));
            updateEntry(entry);
            console.error(`AgentBuzzer ${channel} delivery retry ${entry.attempts}: ${error.message}`);
          }
        }
        if (!entry.pendingChannels.length) removeEntry(entry);
      }
    } finally { working = false; }
  }

  async function accept(event) {
    if (!event || ![...AGENTS, "AgentBuzzer"].includes(event.agent) || !["completed", "failed", "needs_input"].includes(event.status) || typeof event.summary !== "string") {
      throw new Error("Invalid agent event");
    }
    const config = loadConfig(env);
    const n = config.notifications;
    const decision = ingressDecision(n, event.agent, now());
    if (decision !== "queue") return { disposition: "dropped", reason: decision };
    const channels = activeChannels(config.channels);
    if (!channels.length) return { disposition: "dropped", reason: "no_channel" };
    const entry = makeEntry(event, now().getTime(), channels);
    persistEntry(entry, env);
    syncCycle();
    const next = resetBreak(n.cycle, cycle, now().getTime());
    if (next !== cycle) { cycle = next; writeCycle(cycle, env); }
    void pump();
    return { disposition: "queued", id: entry.id };
  }

  function updateSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid settings");
    const old = readSettings(env);
    const updated = { ...old };
    if (input.deviceName !== undefined) {
      if (typeof input.deviceName !== "string" || !input.deviceName.trim() || input.deviceName.length > 100) throw new Error("Invalid device name");
      updated.deviceName = input.deviceName.trim();
    }
    if (input.notifications !== undefined) updated.notifications = validateNotifications(input.notifications);
    if (input.channels !== undefined) {
      if (!input.channels || typeof input.channels !== "object") throw new Error("Invalid channels");
      const current = old.channels || { feishu: old.feishu || {} };
      updated.channels = { ...current };
      for (const name of Object.keys(input.channels)) if (!CHANNELS.includes(name)) throw new Error("Unknown channel");
      const { feishu = {}, webhook = {}, slack = {} } = input.channels;
      for (const [name, value] of Object.entries({ feishu, webhook, slack })) {
        if (!value || typeof value !== "object" || (value.enabled !== undefined && typeof value.enabled !== "boolean")) throw new Error(`Invalid ${name} settings`);
        updated.channels[name] = { ...current[name], ...value };
      }
      const { appId, receiveId, receiveIdType, secret } = feishu;
      if (receiveIdType !== undefined && !["open_id", "chat_id", "user_id", "email"].includes(receiveIdType)) throw new Error("Invalid recipient type");
      for (const value of [appId, receiveId]) if (value !== undefined && (typeof value !== "string" || value.length > 200)) throw new Error("Invalid Feishu setting");
      if (secret !== undefined && (typeof secret !== "string" || !secret || secret.length > 1000)) throw new Error("Invalid secret");
      delete updated.channels.feishu.secret;
      for (const name of ["webhook", "slack"]) {
        const url = input.channels[name]?.url;
        if (url !== undefined) updated.channels[name].url = validateEndpoint(url, name);
        if (updated.channels[name].enabled && !(updated.channels[name].url || env[name === "webhook" ? "AGENTBUZZER_WEBHOOK_URL" : "AGENTBUZZER_SLACK_WEBHOOK_URL"])) {
          throw new Error(`Configure ${name} URL before enabling it`);
        }
      }
      if (secret) saveSecret(secret);
    }
    saveSettings(updated, env);
    syncCycle();
    const config = loadConfig(env);
    const discarded = purgeDisabled(config.notifications, config.channels, env);
    void pump();
    return { settings: safeSettings(env), discarded };
  }

  async function snapshot() {
    syncCycle();
    if (Date.now() - statusCache.time > 15000) {
      statusCache = { time: Date.now(), value: await adapterStatus() };
    }
    return {
      settings: safeSettings(env),
      cycle,
      queue: listEntries(env).map(({ id, event, createdAt, attempts, pendingChannels }) => ({ id, agent: event.agent, status: event.status, summary: event.summary, createdAt, attempts, pendingChannels })),
      adapters: statusCache.value,
    };
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, BASE_URL);
      const origin = `http://127.0.0.1:${server.address()?.port || PORT}`;
      if (request.headers.host !== `127.0.0.1:${server.address()?.port || PORT}` || (request.headers.origin && request.headers.origin !== origin)) {
        return json(response, 403, { error: "Local access only" });
      }
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { service: "agent-buzzer", version: VERSION, buildId: BUILD_ID });
      if (request.method === "POST" && url.pathname === "/api/shutdown") {
        json(response, 200, { stopped: true });
        setImmediate(() => { void service.close(); });
        return;
      }
      if (request.method === "GET" && UI_FILES.has(url.pathname)) {
        const name = UI_FILES.get(url.pathname);
        response.writeHead(200, {
          "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        });
        return response.end(readFileSync(join(ROOT, "src", name)));
      }
      if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, await snapshot());
      if (request.method === "POST" && url.pathname === "/api/events") return json(response, 200, await accept(await body(request)));
      if (request.method === "PUT" && url.pathname === "/api/settings") return json(response, 200, updateSettings(await body(request)));
      if (request.method === "POST" && /^\/api\/install\/(codex|copilot|hermes)$/.test(url.pathname)) {
        const agent = url.pathname.split("/").at(-1);
        const output = await runCommand(process.execPath, [join(ROOT, "scripts", "install.mjs"), `--${agent}`, "--force"]);
        statusCache.time = 0;
        return json(response, 200, { output: output.trim() });
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  });

  const service = {
    accept, pump, snapshot, updateSettings,
    async start(port = PORT) {
      await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolvePromise(); });
      });
      const config = loadConfig(env);
      purgeDisabled(config.notifications, config.channels, env);
      tickTimer = setInterval(() => { void pump().catch((error) => console.error(`AgentBuzzer: ${error.message}`)); }, intervalMs);
      await pump();
      return server.address().port;
    },
    async close() {
      closing = true;
      clearInterval(tickTimer);
      await new Promise((resolvePromise) => server.close(resolvePromise));
      while (working) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    },
  };
  return service;
}
