import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { AGENTS, CHANNELS, loadChannelConfig, loadConfig, readSettings, safeChannelSettings, saveSettings } from "./config.mjs";
import { activeChannels, sendChannel } from "./channels.mjs";
import { CHANNEL_CATALOG, channelDefinition, channelEnv, validateField } from "./channel-schema.mjs";
import { advanceCycle, deliveryDecision, ingressDecision, resetBreak, validateNotifications } from "./policy.mjs";
import { dataPath, listEntries, makeEntry, persistEntry, purgeAgent, purgeDisabled, removeEntry, updateEntry } from "./queue.mjs";
import { credentialKeys, hasSecret, saveCredentials } from "./secret-store.mjs";
import { buildId } from "./build-id.mjs";
import { runCommand as executeCommand } from "./commands.mjs";
import { eventText, webhookPayload } from "./webhook.mjs";
import { LANGUAGES, normalizeLanguage, translate } from "./i18n.mjs";
import { resolveCodexSessionName } from "./codex-session-name.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const BUILD_ID = buildId(ROOT);
export const PORT = Number(process.env.AGENTBUZZER_PORT || 38147);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const UI_FILES = new Map([["/", "ui.html"], ["/ui.css", "ui.css"], ["/ui.js", "ui.js"], ["/i18n.mjs", "i18n.mjs"], ["/icon.svg", "icon.svg"]]);
const ADAPTER_AGENTS = { codex: "Codex", copilot: "GitHub Copilot", hermes: "Hermes" };

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
  const config = loadConfig(env, { includeSecret: false });
  return {
    deviceName: config.deviceName,
    language: config.language,
    notifications: config.notifications,
    channels: safeChannelSettings(env),
  };
}

function runCommand(program, args, timeout = 120000) {
  return executeCommand(program, args, { timeoutMs: timeout, cwd: ROOT, env: { ...process.env, AGENTBUZZER_NODE: process.execPath } });
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
        : Boolean(list.some((item) => item.name === "agent-buzzer" && item.marketplace === "agent-buzzer-local" && item.enabled !== false)) };
    } catch {
      results[agent] = { available: false, installed: false };
    }
  }
  const home = process.env.HERMES_HOME || join(homedir(), ".hermes");
  let hermesAvailable = false;
  try { await runCommand("hermes", ["--version"], 6000); hermesAvailable = true; } catch { /* CLI not installed. */ }
  const manifest = join(home, "plugins", "agent-buzzer", "plugin.yaml");
  let hermesInstalled = false;
  try { hermesInstalled = /^name:\s*agent-buzzer\s*$/m.test(readFileSync(manifest, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  results.hermes = { available: hermesAvailable, installed: hermesInstalled };
  return results;
}

export function createService({ env = process.env, deliver = sendChannel, detectAdapters = adapterStatus, resolveCodexName = resolveCodexSessionName, uninstall = async (agent) => JSON.parse(await runCommand(process.execPath, [join(ROOT, "scripts", "uninstall.mjs"), `--${agent}`])), now = () => new Date(), intervalMs = 1000 } = {}) {
  let cycle = readCycle(env);
  let working = false;
  let closing = false;
  let tickTimer;
  let statusCache = { time: 0, value: null };
  let statusCheck = null;
  let statusError = null;
  let statusGeneration = 0;
  const uninstallingAgents = new Set();
  const channelDelivery = {};

  function saveProgress(entry) {
    if (!existsSync(entry.path)) return false;
    const current = loadConfig(env, { includeSecret: false });
    if (deliveryDecision(current.notifications, entry.event.agent, cycle.phase, now()) === "drop") { removeEntry(entry); return false; }
    entry.pendingChannels = entry.pendingChannels.filter((name) => current.channels[name]?.enabled);
    if (!entry.pendingChannels.length) { removeEntry(entry); return false; }
    if (entry.channelRetries) {
      entry.channelRetries = Object.fromEntries(entry.pendingChannels.filter((name) => entry.channelRetries[name]).map((name) => [name, entry.channelRetries[name]]));
      entry.nextAttemptAt = Math.min(...entry.pendingChannels.map((name) => entry.channelRetries[name]?.nextAttemptAt || 0));
    }
    updateEntry(entry);
    return true;
  }

  function syncCycle() {
    const next = advanceCycle(loadConfig(env, { includeSecret: false }).notifications.cycle, cycle, now().getTime());
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
        if (uninstallingAgents.has(entry.event.agent)) continue;
        let config = loadConfig(env, { includeSecret: false });
        let decision = deliveryDecision(config.notifications, entry.event.agent, cycle.phase, now());
        if (decision === "drop") { removeEntry(entry); continue; }
        entry.pendingChannels ||= activeChannels(config.channels);
        if (entry.event.agent === "Codex" && entry.event.sessionId && !entry.event.sessionName && !entry.sessionNameResolved) {
          let name = "";
          try { name = eventText(await resolveCodexName(entry.event.sessionId, { env }), 256); }
          catch { /* A missing title must not prevent delivery. */ }
          if (name) entry.event.sessionName = name;
          entry.sessionNameResolved = true;
          if (!saveProgress(entry)) continue;
          config = loadConfig(env, { includeSecret: false });
          decision = deliveryDecision(config.notifications, entry.event.agent, cycle.phase, now());
        }
        if (decision === "wait" || entry.nextAttemptAt > now().getTime()) continue;
        for (const channel of [...entry.pendingChannels]) {
          if (!existsSync(entry.path) || uninstallingAgents.has(entry.event.agent)) break;
          const current = loadConfig(env, { includeSecret: false });
          const currentDecision = deliveryDecision(current.notifications, entry.event.agent, cycle.phase, now());
          if (currentDecision === "drop") { removeEntry(entry); break; }
          if (currentDecision === "wait" || closing) break;
          if (!current.channels[channel]?.enabled) {
            entry.pendingChannels = entry.pendingChannels.filter((name) => name !== channel);
            if (!saveProgress(entry)) break;
            continue;
          }
          entry.channelRetries ||= {};
          const retry = entry.channelRetries[channel];
          if (retry?.nextAttemptAt > now().getTime()) continue;
          try {
            const channelConfig = loadChannelConfig(channel, env);
            channelDelivery[channel] = { state: "sending", time: now().toISOString() };
            await deliver(channel, channelConfig, entry.event, entry.deviceName || current.deviceName, undefined, { deliveryId: entry.id, createdAt: entry.createdAt, language: current.language });
            channelDelivery[channel] = { state: "sent", time: now().toISOString() };
            entry.pendingChannels = entry.pendingChannels.filter((name) => name !== channel);
            delete entry.channelRetries[channel];
            if (!saveProgress(entry)) break;
          } catch (error) {
            entry.attempts++;
            const attempts = (retry?.attempts || 0) + 1;
            entry.channelRetries[channel] = { attempts, nextAttemptAt: now().getTime() + Math.max(Math.min(300000, 2000 * 2 ** Math.min(attempts - 1, 8)), Math.min(86400000, Number(error.retryAfterMs) || 0)) };
            entry.nextAttemptAt = Math.min(...entry.pendingChannels.map((name) => entry.channelRetries[name]?.nextAttemptAt || 0));
            channelDelivery[channel] = { state: "failed", time: now().toISOString(), ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}), ...(error.code === "MATRIX_ENCRYPTED_ROOM" ? { reason: error.code } : {}) };
            if (!saveProgress(entry)) break;
            console.error(`AgentBuzzer ${channel} delivery retry ${entry.attempts}: ${error.message}`);
          }
        }
        if (!entry.pendingChannels.length) removeEntry(entry);
      }
    } finally { working = false; }
  }

  async function accept(event, selectedChannels) {
    if (!event || ![...AGENTS, "AgentBuzzer"].includes(event.agent) || !["completed", "failed", "needs_input"].includes(event.status) || typeof event.summary !== "string") {
      throw new Error("Invalid agent event");
    }
    const config = loadConfig(env, { includeSecret: false });
    const n = config.notifications;
    const decision = ingressDecision(n, event.agent, now());
    if (decision !== "queue") return { disposition: "dropped", reason: decision };
    const channels = activeChannels(config.channels).filter((name) => !selectedChannels || selectedChannels.includes(name));
    if (!channels.length) return { disposition: "dropped", reason: "no_channel" };
    const entry = makeEntry({ ...event, deviceName: config.deviceName }, now().getTime(), channels);
    persistEntry(entry, env);
    syncCycle();
    const next = resetBreak(n.cycle, cycle, now().getTime());
    if (next !== cycle) { cycle = next; writeCycle(cycle, env); }
    // Acknowledge the durable entry before credential loading or delivery can block.
    setImmediate(() => {
      void pump().catch((error) => console.error(`AgentBuzzer: ${error.message}`));
    });
    return { disposition: "queued", id: entry.id };
  }

  function updateSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid settings");
    const old = readSettings(env);
    const updated = { ...old };
    if (input.language !== undefined) {
      if (!LANGUAGES.includes(input.language)) throw new Error("Invalid language");
      updated.language = input.language;
    }
    let restoreCredentials;
    if (input.deviceName !== undefined) {
      if (typeof input.deviceName !== "string" || !input.deviceName.trim() || input.deviceName.length > 100) throw new Error("Invalid device name");
      updated.deviceName = input.deviceName.trim();
    }
    if (input.notifications !== undefined) updated.notifications = validateNotifications(input.notifications);
    if (input.channels !== undefined) {
      if (!input.channels || typeof input.channels !== "object" || Array.isArray(input.channels)) throw new Error("Invalid channels");
      const current = { ...(old.feishu ? { feishu: old.feishu } : {}), ...old.channels };
      updated.channels = { ...current };
      const changes = {};
      const keys = credentialKeys(env);
      for (const name of Object.keys(input.channels)) if (!CHANNELS.includes(name)) throw new Error("Unknown channel");
      for (const [name, value] of Object.entries(input.channels)) {
        const definition = channelDefinition(name);
        if (!value || typeof value !== "object" || Array.isArray(value) || (value.enabled !== undefined && typeof value.enabled !== "boolean")) throw new Error("Invalid channel settings");
        const known = new Set(["enabled", ...definition.fields.map(({ name }) => name)]);
        for (const key of Object.keys(value)) if (!known.has(key)) throw new Error("Unknown channel field");
        const next = { ...current[name] };
        if (value.enabled !== undefined) next.enabled = value.enabled;
        for (const spec of definition.fields) {
          const supplied = validateField(name, spec, value[spec.name]);
          if (supplied === undefined) continue;
          if (!spec.secret) next[spec.name] = supplied;
          else {
            changes[`${name}.${spec.name}`] = supplied;
            delete next[spec.name];
            if (spec.property) delete next[spec.property];
            next.clearedSecrets = [...new Set([...(next.clearedSecrets || []).filter((key) => key !== spec.name), ...(supplied == null || supplied === "" ? [spec.name] : [])])];
          }
        }
        const enabled = definition.defaultEnabled ? next.enabled !== false : next.enabled === true;
        for (const spec of definition.fields) {
          const key = `${name}.${spec.name}`;
          const stored = Object.hasOwn(changes, key) ? changes[key] : (keys.has(key) ? true : (!next.clearedSecrets?.includes(spec.name) && (next[spec.name] || next[spec.property] || (name === "feishu" && spec.name === "secret" && hasSecret()))));
          const available = env[channelEnv(name, spec)] || (spec.secret ? stored : next[spec.name] ?? spec.default);
          if (enabled && spec.required && (available === undefined || available === null || available === "" || available === false)) throw new Error(`Configure ${definition.label}: ${spec.label}`);
        }
        const emailPassword = env.AGENTBUZZER_EMAIL_PASSWORD || (Object.hasOwn(changes, "email.password") ? changes["email.password"] : keys.has("email.password") || (!next.clearedSecrets?.includes("password") && next.password));
        if (enabled && name === "email" && (next.user || env.AGENTBUZZER_EMAIL_USER) && !emailPassword) throw new Error("Configure SMTP password before enabling authentication");
        updated.channels[name] = next;
      }
      if (Object.keys(changes).length) restoreCredentials = saveCredentials(changes, env);
    }
    try { saveSettings(updated, env); }
    catch (error) { restoreCredentials?.(); throw error; }
    syncCycle();
    const config = loadConfig(env, { includeSecret: false });
    const discarded = purgeDisabled(config.notifications, config.channels, env);
    void pump();
    return { settings: safeSettings(env), discarded };
  }

  async function snapshot() {
    syncCycle();
    if (!statusCheck && (!statusCache.time || Date.now() - statusCache.time > 15000)) {
      const generation = statusGeneration;
      statusError = null;
      statusCheck = Promise.resolve().then(detectAdapters).then((value) => {
        if (generation === statusGeneration) statusCache = { time: Date.now(), value };
      }).catch(() => {
        if (generation === statusGeneration) {
          statusError = "Adapter detection failed";
          statusCache.time = Date.now();
        }
      }).finally(() => { statusCheck = null; });
    }
    return {
      settings: safeSettings(env),
      channelCatalog: CHANNEL_CATALOG,
      channelDelivery: { ...channelDelivery },
      cycle,
      queue: listEntries(env).map(({ id, event, createdAt, attempts, pendingChannels }) => ({ id, agent: event.agent, status: event.status, summary: event.summary, summaryKey: event.summaryKey, createdAt, attempts, pendingChannels })),
      adapters: statusCache.value,
      adaptersChecking: Boolean(statusCheck),
      adaptersError: statusError,
    };
  }

  async function testChannel(name) {
    channelDefinition(name);
    const config = loadConfig(env, { includeSecret: false });
    if (!config.notifications.enabled) return { disposition: "dropped", reason: "disabled" };
    const status = safeChannelSettings(env)[name];
    if (!status.enabled) return { disposition: "dropped", reason: "channel_disabled" };
    if (!status.configured) throw new Error("Channel configuration is incomplete");
    return accept({ agent: "AgentBuzzer", status: "completed", summary: "这是一条 AgentBuzzer 测试通知。", summaryKey: "这是一条 AgentBuzzer 测试通知。", key: randomUUID() }, [name]);
  }

  async function removeAdapter(agent) {
    const name = ADAPTER_AGENTS[agent];
    if (!name) throw new Error("Unsupported adapter");
    if (uninstallingAgents.has(name)) throw new Error("Adapter removal is already running");
    uninstallingAgents.add(name);
    try {
      const result = await uninstall(agent);
      if (typeof result?.removed !== "boolean") throw new Error("Invalid uninstall result");
      while (working) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      return { ...result, discarded: purgeAgent(name, env) };
    } finally {
      uninstallingAgents.delete(name);
      statusGeneration++;
      statusCache.time = 0;
      statusCache.value = null;
      void pump().catch((error) => console.error(`AgentBuzzer: ${error.message}`));
    }
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
        let file = readFileSync(join(ROOT, "src", name));
        if (name === "ui.html") {
          let language = "zh-CN";
          try { language = normalizeLanguage(readSettings(env).language); } catch { /* Keep the retry UI available when settings are unreadable. */ }
          file = file.toString().replace("{{language}}", language);
        }
        response.writeHead(200, {
          "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : /\.m?js$/.test(name) ? "text/javascript; charset=utf-8" : name.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        });
        return response.end(file);
      }
      if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, await snapshot());
      if (request.method === "POST" && url.pathname === "/api/events") return json(response, 200, await accept(await body(request)));
      if (request.method === "PUT" && url.pathname === "/api/settings") return json(response, 200, updateSettings(await body(request)));
      if (request.method === "POST" && url.pathname === "/api/webhook/preview") {
        const input = await body(request);
        const definition = channelDefinition("webhook");
        const config = Object.fromEntries(definition.fields.filter(({ secret }) => !secret).map((spec) => [spec.name, validateField("webhook", spec, input[spec.name] ?? spec.default)]));
        const current = loadConfig(env, { includeSecret: false });
        return json(response, 200, webhookPayload(config, { agent: "Codex", status: "completed", summary: translate("任务已完成", current.language), sessionName: translate("示例会话", current.language), sessionId: "session-example", turnId: "turn-example", occurredAt: "2026-01-01T08:00:00.000Z" }, current.deviceName, { deliveryId: "event-example", language: current.language }));
      }
      if (request.method === "POST" && /^\/api\/channels\/[A-Za-z0-9_-]+\/test$/.test(url.pathname)) return json(response, 200, await testChannel(url.pathname.split("/")[3]));
      if (request.method === "POST" && /^\/api\/install\/(codex|copilot|hermes)$/.test(url.pathname)) {
        const agent = url.pathname.split("/").at(-1);
        const output = await runCommand(process.execPath, [join(ROOT, "scripts", "install.mjs"), `--${agent}`, "--force"]);
        statusGeneration++;
        statusCache.time = 0;
        statusCache.value = null;
        return json(response, 200, { output: output.trim() });
      }
      if (request.method === "POST" && /^\/api\/uninstall\/(codex|copilot|hermes)$/.test(url.pathname)) {
        return json(response, 200, await removeAdapter(url.pathname.split("/").at(-1)));
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 400, { error: error instanceof SyntaxError ? "Invalid JSON input" : error.message });
    }
  });

  const service = {
    accept, pump, snapshot, updateSettings, removeAdapter, testChannel,
    async start(port = PORT) {
      await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolvePromise(); });
      });
      const config = loadConfig(env, { includeSecret: false });
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
