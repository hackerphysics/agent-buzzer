import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadSecret } from "./secret-store.mjs";

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

export function loadConfig(env = process.env) {
  const settings = readSettings(env);
  const feishu = settings.feishu || {};
  const receiveId = env.AGENTBUZZER_FEISHU_RECEIVE_ID || feishu.receiveId;
  const receiveIdType = env.AGENTBUZZER_FEISHU_RECEIVE_ID_TYPE || feishu.receiveIdType || "open_id";
  if (!["open_id", "chat_id", "user_id", "email"].includes(receiveIdType)) {
    throw new Error("Feishu receiveIdType must be open_id, chat_id, user_id or email");
  }
  return {
    deviceName: env.AGENTBUZZER_DEVICE_NAME || settings.deviceName || env.COMPUTERNAME || hostname(),
    feishu: {
      appId: env.AGENTBUZZER_FEISHU_APP_ID || feishu.appId,
      appSecret: env.AGENTBUZZER_FEISHU_APP_SECRET || loadSecret(),
      receiveId,
      receiveIdType,
    },
  };
}
