import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSecret } from "./secret-store.mjs";

export const AGENTS = ["Codex", "GitHub Copilot", "Hermes"];
export const CHANNELS = ["feishu", "webhook", "slack"];

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
    throw new Error(`Cannot read AgentBuzzer settings: ${error.message}`);
  }
}

export function saveSettings(settings, env = process.env) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export function loadConfig(env = process.env) {
  const settings = readSettings(env);
  const feishu = settings.channels?.feishu || settings.feishu || {};
  const webhook = settings.channels?.webhook || {};
  const slack = settings.channels?.slack || {};
  const receiveId = env.AGENTBUZZER_FEISHU_RECEIVE_ID || feishu.receiveId;
  const receiveIdType = env.AGENTBUZZER_FEISHU_RECEIVE_ID_TYPE || feishu.receiveIdType || "open_id";
  if (!["open_id", "chat_id", "user_id", "email"].includes(receiveIdType)) {
    throw new Error("Feishu receiveIdType must be open_id, chat_id, user_id or email");
  }
  const feishuConfig = {
    enabled: feishu.enabled !== false,
    appId: env.AGENTBUZZER_FEISHU_APP_ID || feishu.appId,
    appSecret: env.AGENTBUZZER_FEISHU_APP_SECRET || loadSecret(),
    receiveId,
    receiveIdType,
  };
  return {
    deviceName: env.AGENTBUZZER_DEVICE_NAME || settings.deviceName || env.COMPUTERNAME || hostname(),
    notifications: notificationSettings(settings.notifications),
    feishu: feishuConfig,
    channels: {
      feishu: feishuConfig,
      webhook: { enabled: webhook.enabled === true, url: env.AGENTBUZZER_WEBHOOK_URL || webhook.url },
      slack: { enabled: slack.enabled === true, url: env.AGENTBUZZER_SLACK_WEBHOOK_URL || slack.url },
    },
  };
}
