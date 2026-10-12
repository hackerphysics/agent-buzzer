import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { shortSummary } from "./card.mjs";
import { channelDefinition, validateEndpoint, validateField } from "./channel-schema.mjs";
import { webhookPayload } from "./webhook.mjs";

export function notificationText(event, deviceName) {
  const status = { completed: "已完成", needs_input: "等待处理", failed: "未完成" }[event.status] || event.status;
  return `AgentBuzzer · ${event.agent} · ${deviceName} · ${status}\n${shortSummary(event.summary, "任务状态已更新")}`;
}

function deliveryError(name, response) {
  const error = new Error(`${channelDefinition(name).label} HTTP ${response.status}`);
  error.httpStatus = response.status;
  const header = response.headers?.get("retry-after");
  const seconds = Number(header);
  const wait = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()) : 0;
  if (wait > 0) error.retryAfterMs = Math.min(86400000, Math.max(1000, wait));
  return error;
}

async function responseError(name, response) {
  const error = deliveryError(name, response);
  if (response.status === 429 && response.json) {
    try {
      const result = await response.json();
      const seconds = Number(result.parameters?.retry_after ?? result.retry_after);
      if (seconds > 0 && Number.isFinite(seconds)) error.retryAfterMs = Math.max(error.retryAfterMs || 0, Math.min(86400000, seconds * 1000));
    } catch { /* The HTTP status still describes the failure. */ }
  }
  return error;
}

async function request(name, url, payload, fetchImpl, { headers = {}, form = false, method = "POST" } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method, redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { ...(method !== "GET" ? { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" } : {}), ...headers },
      ...(method !== "GET" ? { body: form ? new URLSearchParams(payload).toString() : JSON.stringify(payload) } : {}),
    });
  } catch { throw new Error(`${channelDefinition(name).label} request failed`); }
  return response;
}

async function jsonResponse(name, response) {
  if (!response.ok) throw await responseError(name, response);
  try { return await response.json(); }
  catch { throw new Error(`${channelDefinition(name).label} returned an invalid response`); }
}

function rejected(name) { return new Error(`${channelDefinition(name).label} rejected the notification`); }
function endpoint(base, path) { return `${base.replace(/\/+$/, "")}/${path}`; }
function transactionId(context) {
  const hex = createHash("sha256").update(context.deliveryId || randomUUID()).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function sendEmail(config, event, deviceName, createTransport) {
  const create = createTransport || (await import("nodemailer")).default.createTransport;
  const transport = create({
    host: config.host, port: config.port, secure: config.tls === "tls", requireTLS: config.tls !== "tls",
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000, dnsTimeout: 8000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  try {
    const info = await transport.sendMail({ from: config.from, to: config.to, subject: `[AgentBuzzer] ${event.agent} · ${deviceName}`, text: notificationText(event, deviceName), disableFileAccess: true, disableUrlAccess: true });
    if (!info.accepted?.length || info.rejected?.length) throw new Error("Rejected recipient");
  } catch (error) { throw new Error(error.code === "EAUTH" ? "SMTP authentication failed" : error.code === "ETIMEDOUT" ? "SMTP timed out" : error.code === "ESOCKET" ? "SMTP connection or TLS failed" : "SMTP delivery failed"); }
  finally { transport.close?.(); }
}

export function hermesText(text) {
  return text.replace(/\bMEDIA\s*:/gi, "MEDIA (text):").replace(/\[\[as_document\]\]/gi, "(as_document)");
}

export async function sendViaHermes(config, text, { spawnImpl = spawn, timeoutMs = 12000 } = {}) {
  const child = spawnImpl(config.program || "hermes", ["send", "--to", config.target, "--file", "-", "--quiet"], {
    shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"], detached: process.platform !== "win32",
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => {
      finish(new Error("Hermes notification timed out"));
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill(); }
      } else if (child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
        killer.unref();
      }
      child.stdin?.destroy();
      child.unref?.();
    }, timeoutMs);
    child.once("error", () => finish(new Error("Hermes executable is unavailable")));
    child.once("close", (code) => finish(code === 0 ? null : new Error("Hermes delivery failed")));
    child.stdin.on("error", () => { /* Close or error supplies the delivery result. */ });
    child.stdin.end(hermesText(text));
  });
}

export async function sendProvider(name, config, event, deviceName, fetchImpl = fetch, context = {}) {
  config = { ...config };
  for (const spec of channelDefinition(name).fields) {
    const property = spec.property || spec.name;
    const value = validateField(name, spec, config[property] ?? spec.default);
    if (spec.required && (value === undefined || value === null || value === "")) throw new Error(`${channelDefinition(name).label} configuration is incomplete`);
    config[property] = value;
  }
  const text = notificationText(event, deviceName);
  const title = `${event.agent} · ${deviceName}`;
  if (name === "email") return sendEmail(config, event, deviceName, context.createTransport);
  if (name === "hermes") return (context.hermesSend || sendViaHermes)(config, text);
  let url, payload, headers = {}, form = false;
  if (["webhook", "slack", "discord", "teams", "googlechat", "mattermost", "feishuBot", "dingtalk", "wecom"].includes(name)) url = validateEndpoint(config.url, name);
  if (["matrix", "ntfy", "bark", "gotify"].includes(name)) validateEndpoint(config.serverUrl, name, { server: true });
  if (name === "webhook") {
    payload = webhookPayload(config, event, deviceName, context);
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
  } else if (name === "slack") {
    payload = { text: text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") };
  } else if (name === "telegram") {
    url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    payload = { chat_id: config.chatId, text, ...(config.threadId ? { message_thread_id: config.threadId } : {}) };
  } else if (name === "discord") {
    const target = new URL(url); target.searchParams.set("wait", "true"); url = target.toString();
    payload = { content: text, allowed_mentions: { parse: [] } };
  } else if (name === "teams") {
    payload = { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.2", body: [{ type: "TextBlock", text: title, weight: "Bolder", wrap: true }, { type: "TextBlock", text, wrap: true }] } }] };
  } else if (name === "googlechat" || name === "mattermost") {
    payload = { text: text.replaceAll("@", "@\u200b") };
  } else if (name === "feishuBot") {
    payload = { msg_type: "text", content: { text } };
    if (config.signingSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      payload.timestamp = timestamp;
      payload.sign = createHmac("sha256", `${timestamp}\n${config.signingSecret}`).update("").digest("base64");
    }
  } else if (name === "dingtalk") {
    payload = { msgtype: "text", text: { content: text }, at: { isAtAll: false } };
    if (config.signingSecret) {
      const timestamp = String(Date.now());
      const target = new URL(url);
      target.searchParams.set("timestamp", timestamp);
      target.searchParams.set("sign", createHmac("sha256", config.signingSecret).update(`${timestamp}\n${config.signingSecret}`).digest("base64"));
      url = target.toString();
    }
  } else if (name === "wecom") {
    payload = { msgtype: "text", text: { content: text } };
  } else if (name === "matrix") {
    const root = endpoint(config.serverUrl, `_matrix/client/v3/rooms/${encodeURIComponent(config.roomId)}`);
    headers.Authorization = `Bearer ${config.accessToken}`;
    const state = await request(name, `${root}/state/m.room.encryption`, null, fetchImpl, { method: "GET", headers });
    if (state.ok) { const error = new Error("Matrix encrypted rooms require an encryption-capable gateway"); error.code = "MATRIX_ENCRYPTED_ROOM"; throw error; }
    let body;
    try { body = await state.json(); } catch { throw rejected(name); }
    if (state.status !== 404 || body.errcode !== "M_NOT_FOUND") throw deliveryError(name, state);
    url = `${root}/send/m.room.message/${transactionId(context)}`;
    payload = { msgtype: "m.text", body: text, "m.mentions": {} };
  } else if (name === "ntfy") {
    url = endpoint(config.serverUrl, "");
    payload = { topic: config.topic, title, message: text, priority: 3, tags: [event.status === "completed" ? "white_check_mark" : "warning"] };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
  } else if (name === "bark") {
    url = endpoint(config.serverUrl, "");
    payload = { device_key: config.deviceKey, title, body: text, group: "AgentBuzzer" };
  } else if (name === "gotify") {
    url = endpoint(config.serverUrl, "message"); headers["X-Gotify-Key"] = config.appToken;
    payload = { title, message: text, priority: config.priority ?? 5 };
  } else if (name === "pushover") {
    url = "https://api.pushover.net/1/messages.json"; form = true;
    payload = { token: config.appToken, user: config.userKey, title, message: text, ...(config.device ? { device: config.device } : {}) };
  } else if (name === "line") {
    url = "https://api.line.me/v2/bot/message/push";
    headers = { Authorization: `Bearer ${config.accessToken}`, "X-Line-Retry-Key": transactionId(context) };
    payload = { to: config.recipientId, messages: [{ type: "text", text }], notificationDisabled: false };
  } else if (name === "sms") {
    url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`; form = true;
    headers.Authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
    payload = { From: config.from, To: config.to, Body: text };
  } else throw new Error("Unknown channel");
  const response = await request(name, url, payload, fetchImpl, { headers, form, ...(name === "matrix" ? { method: "PUT" } : {}) });
  if (name === "line" && response.status === 409 && response.headers?.get("x-line-accepted-request-id")) return;
  if (!response.ok) throw await responseError(name, response);
  if (["webhook", "teams", "mattermost", "line"].includes(name)) return;
  if (name === "slack") {
    if (response.text && (await response.text()).trim() !== "ok") throw rejected(name);
    return;
  }
  const result = await jsonResponse(name, response);
  if (name === "telegram" && result.ok !== true) throw rejected(name);
  if (name === "discord" && !result.id) throw rejected(name);
  if (name === "googlechat" && (!result.name || result.error)) throw rejected(name);
  if (name === "feishuBot" && (result.code ?? result.StatusCode) !== 0) throw rejected(name);
  if (["dingtalk", "wecom"].includes(name) && result.errcode !== 0) throw rejected(name);
  if (name === "matrix" && !result.event_id) throw rejected(name);
  if (["ntfy", "gotify"].includes(name) && !result.id) throw rejected(name);
  if (name === "bark" && result.code !== 200) throw rejected(name);
  if (name === "pushover" && result.status !== 1) throw rejected(name);
  if (name === "sms" && (!result.sid || result.error_code)) throw rejected(name);
}
