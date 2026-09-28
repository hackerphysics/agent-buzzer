import { spawn } from "node:child_process";
import { buildCard } from "./card.mjs";
import { loadConfig, readSettings, saveSettings } from "./config.mjs";
import { fromCodexPermission, fromCodexStop, fromCopilotNotification, fromCopilotStop, fromHermes, waitForCopilotReply } from "./adapters.mjs";
import { getTenantToken } from "./feishu.mjs";
import { saveSecret } from "./secret-store.mjs";
import { ensureService, submitEvent } from "./client.mjs";
import { BASE_URL, createService } from "./service.mjs";

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

function updateFeishu(values) {
  const settings = readSettings();
  const feishu = { ...(settings.channels?.feishu || settings.feishu), ...values };
  saveSettings({ ...settings, channels: { ...settings.channels, feishu } });
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === "serve") {
    const service = createService();
    await service.start();
    console.log(`AgentBuzzer running at ${BASE_URL}`);
    return;
  }
  if (command === "ui") {
    await ensureService();
    console.log(BASE_URL);
    return;
  }
  if (command === "copilot-stop") {
    const input = await readInput();
    const payload = Buffer.from(JSON.stringify({
      transcriptPath: input.transcriptPath || input.transcript_path,
      sessionId: input.sessionId || input.session_id,
    })).toString("base64url");
    const child = spawn(process.execPath, [process.argv[1], "copilot-finish", payload], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return;
  }
  if (command === "copilot-finish") {
    const input = JSON.parse(Buffer.from(rest[0] || "", "base64url").toString("utf8"));
    const reply = await waitForCopilotReply(input.transcriptPath);
    const event = fromCopilotStop(input, reply);
    await submitEvent(event);
    return;
  }
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
    updateFeishu({ receiveIdType: rest[0], receiveId: rest[1] });
    console.log("Feishu recipient saved outside the repository.");
    return;
  }
  if (command === "set-app-id") {
    if (!rest[0]) throw new Error("Usage: agent-buzzer set-app-id <id>");
    updateFeishu({ appId: rest[0] });
    console.log("Feishu App ID saved outside the repository.");
    return;
  }
  if (command === "store-secret") {
    const secret = (await readInputText()).trim();
    saveSecret(secret);
    console.log("Feishu App Secret stored in this user's credential store.");
    return;
  }
  if (command === "doctor") {
    const config = loadConfig();
    console.log(JSON.stringify({
      deviceName: config.deviceName,
      feishuAppIdConfigured: Boolean(config.feishu.appId),
      feishuAppSecretConfigured: Boolean(config.feishu.appSecret),
      feishuRecipientConfigured: Boolean(config.feishu.receiveId),
      channels: Object.fromEntries(Object.entries(config.channels).map(([name, value]) => [name, { enabled: value.enabled, configured: name === "feishu" ? Boolean(value.appId && value.appSecret && value.receiveId) : Boolean(value.url) }])),
      notifications: config.notifications,
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
    const result = await submitEvent({ agent: "AgentBuzzer", status: "completed", summary: "这是一条测试通知。" });
    console.log(`Test event ${result.disposition}.`);
    return;
  }
  const adapt = ADAPTERS[command];
  if (!adapt) throw new Error("Usage: agent-buzzer <ui|serve|doctor|set-device|set-app-id|store-secret|set-recipient|check-token|test-card|codex-stop|codex-permission|copilot-stop|copilot-notification|hermes-event>");
  const event = adapt(await readInput());
  if (event) {
    await submitEvent(event);
  }
  if (command.startsWith("codex-")) process.stdout.write("{}\n");
}
