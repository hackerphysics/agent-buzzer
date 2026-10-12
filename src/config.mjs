import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { credentialKeys, hasSecret, loadCredential, loadSecret } from "./secret-store.mjs";
import { CHANNEL_CATALOG, CHANNELS, channelDefinition, channelEnv } from "./channel-schema.mjs";

export const AGENTS = ["Codex", "GitHub Copilot", "Hermes"];
export { CHANNELS };

export function notificationSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    agents: Object.fromEntries(AGENTS.map((agent) => [agent, value.agents?.[agent] !== false])),
    dnd: value.dnd === true,
    workHours: {
      enabled: value.workHours?.enabled === true,
      days: value.workHours?.days ?? [1, 2, 3, 4, 5],
      start: value.workHours?.start ?? "09:00",
      end: value.workHours?.end ?? "18:00",
    },
    cycle: {
      enabled: value.cycle?.enabled === true,
      workMinutes: value.cycle?.workMinutes ?? 25,
      breakMinutes: value.cycle?.breakMinutes ?? 5,
    },
  };
}

export function configPath(env = process.env) {
  return env.AGENTBUZZER_CONFIG || join(homedir(), ".agent-buzzer", "config.json");
}

export function readSettings(env = process.env) {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("Cannot read AgentBuzzer settings");
  }
}

export function saveSettings(settings, env = process.env) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: "wx", flush: true });
  renameSync(temporary, path);
}

export function loadConfig(env = process.env, { includeSecret = true } = {}) {
  const settings = readSettings(env);
  const channels = Object.fromEntries(CHANNELS.map((name) => [name, loadChannelConfig(name, env, { includeSecret, settings })]));
  if (!["open_id", "chat_id", "user_id", "email"].includes(channels.feishu.receiveIdType)) throw new Error("Invalid Feishu recipient type");
  return {
    deviceName: env.AGENTBUZZER_DEVICE_NAME || settings.deviceName || env.COMPUTERNAME || hostname(),
    notifications: notificationSettings(settings.notifications),
    feishu: channels.feishu,
    channels,
  };
}

export function loadChannelConfig(name, env = process.env, { includeSecret = true, settings = readSettings(env) } = {}) {
  const definition = channelDefinition(name);
  const saved = name === "feishu" ? { ...settings.feishu, ...settings.channels?.feishu } : settings.channels?.[name] || {};
  const channel = { enabled: definition.defaultEnabled ? saved.enabled !== false : saved.enabled === true };
  const keys = includeSecret ? credentialKeys(env) : new Set();
  const existingWebhook = name === "webhook" && Boolean(saved.url || env.AGENTBUZZER_WEBHOOK_URL || credentialKeys(env).has("webhook.url"));
  for (const spec of definition.fields) {
    const property = spec.property || spec.name;
    const fromEnv = env[channelEnv(name, spec)];
    let value = fromEnv !== undefined && fromEnv !== "" ? fromEnv : saved[spec.name] ?? saved[property] ?? spec.default;
    // Keep existing receivers on the old contract until the user opts in.
    if (spec.name === "payloadFormat" && existingWebhook && !fromEnv && saved.payloadFormat === undefined) value = "legacy";
    if (spec.type === "mapping" && fromEnv) {
      try { value = JSON.parse(fromEnv); } catch { throw new Error("Invalid Webhook field mapping environment variable"); }
    }
    if (spec.secret) {
      if (!includeSecret) value = undefined;
      else if (!fromEnv && keys.has(`${name}.${spec.name}`)) value = loadCredential(`${name}.${spec.name}`, env);
      else if (!fromEnv && saved.clearedSecrets?.includes(spec.name)) value = undefined;
      else if (!fromEnv && name === "feishu" && spec.name === "secret") value = loadSecret();
    }
    if (value !== undefined && value !== "" && spec.type === "number") value = Number(value);
    channel[property] = value;
  }
  return channel;
}

export function safeChannelSettings(env = process.env) {
  const settings = readSettings(env);
  const keys = credentialKeys(env);
  return Object.fromEntries(CHANNEL_CATALOG.map((definition) => {
    const name = definition.id;
    const channel = loadChannelConfig(name, env, { includeSecret: false, settings });
    const saved = name === "feishu" ? { ...settings.feishu, ...settings.channels?.feishu } : settings.channels?.[name] || {};
    let configured = true;
    for (const spec of definition.fields) {
      if (spec.secret) {
        const fromEnv = Boolean(env[channelEnv(name, spec)]);
        const present = Boolean(fromEnv || keys.has(`${name}.${spec.name}`) || (!saved.clearedSecrets?.includes(spec.name) && (saved[spec.name] || (spec.property && saved[spec.property]) || (name === "feishu" && spec.name === "secret" && hasSecret()))));
        delete channel[spec.property || spec.name];
        channel[`${spec.name}Configured`] = present;
        channel[`${spec.name}FromEnv`] = fromEnv;
        if (spec.required && !present) configured = false;
      } else {
        channel[spec.name] ??= spec.default ?? "";
        if (spec.required && channel[spec.name] === "") configured = false;
      }
    }
    channel.configured = configured;
    if (name === "email" && channel.user && !channel.passwordConfigured) channel.configured = false;
    return [name, channel];
  }));
}
