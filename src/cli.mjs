import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildCard } from "./card.mjs";
import { configPath, loadConfig, readSettings } from "./config.mjs";
import { fromCodexPermission, fromCodexStop, fromCopilotNotification, fromCopilotStop, fromHermes } from "./adapters.mjs";
import { getTenantToken, sendCard } from "./feishu.mjs";
import { saveSecret } from "./secret-store.mjs";

const ADAPTERS = {
  "codex-stop": fromCodexStop,
  "codex-permission": fromCodexPermission,
  "copilot-stop": fromCopilotStop,
  "copilot-notification": fromCopilotNotification,
  "hermes-event": fromHermes,
};

async function readInputText() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 2_000_000) throw new Error("Hook input is too large");
  }
  return value;
}

async function readInput() {
  return JSON.parse((await readInputText()) || "{}");
}

function saveSettings(settings) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === "set-device") {
    if (!rest[0]?.trim()) throw new Error("Usage: agent-buzzer set-device <name>");
    saveSettings({ ...readSettings(), deviceName: rest.join(" ").trim() });
    console.log("Device name saved outside the repository.");
    return;
  }
  if (command === "set-recipient") {
    if (!["open_id", "chat_id", "user_id", "email"].includes(rest[0]) || !rest[1]) {
      throw new Error("Usage: agent-buzzer set-recipient <open_id|chat_id|user_id|email> <id>");
    }
    const settings = readSettings();
    saveSettings({ ...settings, feishu: { ...settings.feishu, receiveIdType: rest[0], receiveId: rest[1] } });
    console.log("Feishu recipient saved outside the repository.");
    return;
  }
  if (command === "set-app-id") {
    if (!rest[0]) throw new Error("Usage: agent-buzzer set-app-id <id>");
    const settings = readSettings();
    saveSettings({ ...settings, feishu: { ...settings.feishu, appId: rest[0] } });
    console.log("Feishu App ID saved outside the repository.");
    return;
  }
  if (command === "store-secret") {
    const secret = (await readInputText()).trim();
    saveSecret(secret);
    console.log("Feishu App Secret encrypted for this Windows user.");
    return;
  }
  if (command === "doctor") {
    const config = loadConfig();
    console.log(JSON.stringify({
      deviceName: config.deviceName,
      feishuAppIdConfigured: Boolean(config.feishu.appId),
      feishuAppSecretConfigured: Boolean(config.feishu.appSecret),
      feishuRecipientConfigured: Boolean(config.feishu.receiveId),
    }, null, 2));
    return;
  }
  if (command === "check-token") {
    await getTenantToken(loadConfig().feishu);
    console.log("Feishu authentication succeeded.");
    return;
  }
  if (command === "test-card") {
    const config = loadConfig();
    const card = buildCard({ agent: "AgentBuzzer", status: "completed", summary: "这是一条测试通知。" }, config.deviceName);
    if (rest.includes("--dry-run")) {
      console.log(JSON.stringify(card, null, 2));
      return;
    }
    await sendCard(config.feishu, card);
    console.log("Feishu interactive card sent.");
    return;
  }
  const adapt = ADAPTERS[command];
  if (!adapt) throw new Error("Usage: agent-buzzer <doctor|set-device|set-app-id|store-secret|set-recipient|check-token|test-card|codex-stop|codex-permission|copilot-stop|copilot-notification|hermes-event>");
  const event = adapt(await readInput());
  if (event) {
    const config = loadConfig();
    await sendCard(config.feishu, buildCard(event, config.deviceName));
  }
  if (command.startsWith("codex-")) process.stdout.write("{}\n");
}
