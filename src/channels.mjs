import { CHANNELS } from "./config.mjs";
import { buildCard } from "./card.mjs";
import { sendCard } from "./feishu.mjs";

export function activeChannels(channels) {
  return CHANNELS.filter((name) => channels[name]?.enabled);
}

export function validateEndpoint(value, kind) {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid webhook URL");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid webhook URL"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Webhook URL must use HTTPS without embedded credentials");
  if (kind === "slack" && (!["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) || !url.pathname.startsWith("/services/"))) {
    throw new Error("Slack requires a Slack Incoming Webhook URL");
  }
  return value;
}

function message(event, deviceName) {
  const status = { completed: "已完成", needs_input: "等待处理", failed: "未完成" }[event.status];
  return `${event.agent} · ${deviceName} · ${status}\n${event.summary}`;
}

async function post(url, payload, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error("Webhook request failed"); }
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
}

export async function sendChannel(name, config, event, deviceName, fetchImpl = fetch) {
  if (name === "feishu") return sendCard(config, buildCard(event, deviceName), fetchImpl);
  if (name === "webhook") {
    if (!config.url) throw new Error("Webhook URL is not configured");
    validateEndpoint(config.url, "webhook");
    return post(config.url, { event, deviceName }, fetchImpl);
  }
  if (name === "slack") {
    if (!config.url) throw new Error("Slack webhook URL is not configured");
    validateEndpoint(config.url, "slack");
    const text = message(event, deviceName).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return post(config.url, { text }, fetchImpl);
  }
  throw new Error(`Unknown channel: ${name}`);
}
