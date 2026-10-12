import { basename, isAbsolute } from "node:path";
import { WEBHOOK_FIELDS, validateMapping } from "./webhook.mjs";

const field = (name, label, options = {}) => ({ name, label, type: "text", required: true, ...options });
const secret = (name, label, options = {}) => field(name, label, { secret: true, type: "password", ...options });
const webhook = (label = "Webhook URL") => secret("url", label, { format: "endpoint" });
const server = (value) => field("serverUrl", "服务地址", { format: "server", ...(value ? { default: value } : {}) });

export const CHANNEL_CATALOG = [
  { id: "feishu", label: "飞书应用", group: "协作与聊天", defaultEnabled: true, fields: [field("appId", "App ID"), field("receiveIdType", "接收者类型", { type: "select", default: "open_id", options: ["chat_id", "open_id", "user_id", "email"] }), field("receiveId", "接收者 ID"), secret("secret", "App Secret", { property: "appSecret", env: "AGENTBUZZER_FEISHU_APP_SECRET" })] },
  { id: "slack", label: "Slack", group: "协作与聊天", fields: [webhook("Incoming Webhook URL")] },
  { id: "telegram", label: "Telegram", group: "协作与聊天", fields: [secret("botToken", "Bot Token"), field("chatId", "Chat ID"), field("threadId", "Topic ID", { type: "number", required: false, min: 1 })] },
  { id: "discord", label: "Discord", group: "协作与聊天", fields: [webhook()] },
  { id: "teams", label: "Microsoft Teams", group: "协作与聊天", fields: [webhook("Workflows Webhook URL")] },
  { id: "googlechat", label: "Google Chat", group: "协作与聊天", fields: [webhook()] },
  { id: "mattermost", label: "Mattermost", group: "协作与聊天", fields: [webhook()] },
  { id: "matrix", label: "Matrix", group: "协作与聊天", fields: [server(), field("roomId", "Room ID"), secret("accessToken", "Access Token")] },
  { id: "line", label: "LINE", group: "协作与聊天", fields: [secret("accessToken", "Channel Access Token"), field("recipientId", "User / Group / Room ID")] },
  { id: "feishuBot", label: "飞书群机器人", group: "国内机器人", fields: [webhook(), secret("signingSecret", "签名密钥", { required: false })] },
  { id: "dingtalk", label: "钉钉群机器人", group: "国内机器人", fields: [webhook(), secret("signingSecret", "加签密钥", { required: false })] },
  { id: "wecom", label: "企业微信群机器人", group: "国内机器人", fields: [webhook()] },
  { id: "ntfy", label: "ntfy", group: "移动推送", fields: [server("https://ntfy.sh"), secret("topic", "Topic"), secret("accessToken", "Access Token", { required: false })] },
  { id: "bark", label: "Bark", group: "移动推送", fields: [server("https://api.day.app"), secret("deviceKey", "Device Key")] },
  { id: "gotify", label: "Gotify", group: "移动推送", fields: [server(), secret("appToken", "Application Token"), field("priority", "优先级", { type: "number", default: 5, min: 0, max: 10 })] },
  { id: "pushover", label: "Pushover", group: "移动推送", fields: [secret("appToken", "Application Token"), secret("userKey", "User Key"), field("device", "Device", { required: false })] },
  { id: "email", label: "邮件 SMTP", group: "邮件与短信", fields: [field("host", "SMTP Host"), field("port", "SMTP Port", { type: "number", default: 587, min: 1, max: 65535 }), field("tls", "传输加密", { type: "select", default: "starttls", options: ["starttls", "tls"] }), field("user", "用户名", { required: false }), secret("password", "密码 / App Password", { required: false }), field("from", "发件人邮箱"), field("to", "收件人邮箱")] },
  { id: "sms", label: "短信 Twilio", group: "邮件与短信", paid: true, fields: [field("accountSid", "Account SID"), secret("authToken", "Auth Token"), field("from", "发送号码"), field("to", "接收号码")] },
  { id: "webhook", label: "通用 Webhook", group: "桥接与自定义", fields: [webhook("HTTPS URL"), secret("accessToken", "Bearer Token", { required: false }), field("payloadFormat", "消息格式", { type: "select", default: "standard", options: ["standard", "legacy"], optionLabels: { standard: "标准消息 v1", legacy: "旧格式：event + deviceName" } }), field("fieldMapping", "字段映射", { type: "mapping", required: false, default: {}, fields: WEBHOOK_FIELDS })] },
  { id: "hermes", label: "Hermes 发送桥接", group: "桥接与自定义", fields: [field("target", "投递目标"), field("program", "Hermes 可执行文件", { default: "hermes" })] },
];

export const CHANNELS = CHANNEL_CATALOG.map(({ id }) => id);
export function channelDefinition(name) {
  const definition = CHANNEL_CATALOG.find(({ id }) => id === name);
  if (!definition) throw new Error("Unknown channel");
  return definition;
}

export function channelEnv(name, spec) {
  if (spec.env) return spec.env;
  const prefix = name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  const suffix = spec.name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  return `AGENTBUZZER_${prefix}_${suffix}`;
}

export function validateEndpoint(value, kind, { server = false } = {}) {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid notification URL");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid notification URL"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(server && local && url.protocol === "http:")) || url.username || url.password || url.hash) {
    throw new Error("Notification URL must use HTTPS without embedded credentials (local servers may use HTTP)");
  }
  if (server && url.search) throw new Error("Server URL must not contain query credentials");
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (kind === "slack" && (!["hooks.slack.com", "hooks.slack-gov.com"].includes(host) || !path.startsWith("/services/"))) throw new Error("Slack requires a Slack Incoming Webhook URL");
  if (kind === "discord" && (!["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(host) || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(path))) throw new Error("Discord requires a Discord Webhook URL");
  if (kind === "teams" && !(host.endsWith(".logic.azure.com") || host.endsWith(".api.powerplatform.com"))) throw new Error("Teams requires a Power Automate Workflows webhook");
  if (kind === "googlechat" && (host !== "chat.googleapis.com" || !/^\/v1\/spaces\/[^/]+\/messages$/.test(path) || !url.searchParams.has("key") || !url.searchParams.has("token"))) throw new Error("Google Chat requires a space webhook URL");
  if (kind === "feishuBot" && (host !== "open.feishu.cn" || !path.startsWith("/open-apis/bot/v2/hook/"))) throw new Error("Feishu requires a group-bot webhook URL");
  if (kind === "dingtalk" && (host !== "oapi.dingtalk.com" || path !== "/robot/send" || !url.searchParams.get("access_token"))) throw new Error("DingTalk requires a robot webhook URL");
  if (kind === "wecom" && (host !== "qyapi.weixin.qq.com" || path !== "/cgi-bin/webhook/send" || !url.searchParams.get("key"))) throw new Error("WeCom requires a group-bot webhook URL");
  return url.toString();
}

export function validateField(name, spec, value) {
  if (value === undefined) return undefined;
  if (value === null && spec.secret) return null;
  if (spec.type === "mapping") return validateMapping(value);
  if (spec.type === "number") {
    if (value === "" && !spec.required) return "";
    if (!["string", "number"].includes(typeof value)) throw new Error(`Invalid ${spec.label}`);
    const number = Number(value);
    if (!Number.isInteger(number) || number < (spec.min ?? 0) || number > (spec.max ?? Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${spec.label}`);
    return number;
  }
  if (typeof value !== "string" || value.length > (spec.secret ? 4096 : 1000) || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${spec.label}`);
  const text = spec.name === "password" ? value : value.trim();
  if (!text) return "";
  if (spec.options && !spec.options.includes(text)) throw new Error(`Invalid ${spec.label}`);
  if (spec.format) return validateEndpoint(text, name, { server: spec.format === "server" });
  if (name === "telegram" && spec.name === "botToken" && !/^\d+:[A-Za-z0-9_-]{20,200}$/.test(text)) throw new Error("Invalid Telegram Bot Token");
  if (name === "telegram" && spec.name === "chatId" && !/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(text)) throw new Error("Invalid Telegram Chat ID");
  if (name === "ntfy" && spec.name === "topic" && !/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw new Error("Invalid ntfy Topic");
  if (name === "matrix" && spec.name === "roomId" && !/^![^\s:]+:[^\s]+$/.test(text)) throw new Error("Matrix requires a Room ID, not a room alias");
  if (name === "line" && spec.name === "recipientId" && !/^[UCR][a-fA-F0-9]{32}$/.test(text)) throw new Error("Invalid LINE recipient ID");
  if (name === "sms" && spec.name === "accountSid" && !/^AC[a-fA-F0-9]{32}$/.test(text)) throw new Error("Invalid Twilio Account SID");
  if (name === "sms" && ["from", "to"].includes(spec.name) && !/^\+[1-9]\d{6,14}$/.test(text)) throw new Error("SMS numbers must use E.164 format");
  if (name === "email" && ["from", "to"].includes(spec.name) && !/^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(text)) throw new Error("Invalid email address");
  if (name === "email" && spec.name === "host" && !/^[A-Za-z0-9._:-]+$/.test(text)) throw new Error("Invalid SMTP host");
  if (name === "hermes" && spec.name === "target" && !/^[a-z][a-z0-9_-]*(?::[^\r\n\0]+)?$/.test(text)) throw new Error("Invalid Hermes delivery target");
  if (name === "hermes" && spec.name === "program" && !isAbsolute(text) && !/^[A-Za-z0-9._-]+$/.test(text)) throw new Error("Hermes program must be an executable path, not a shell command");
  if (name === "hermes" && spec.name === "program" && !["hermes", "hermes.exe", "hermes-agent"].includes(basename(text).toLowerCase())) throw new Error("Select a Hermes executable, not a general-purpose shell");
  return text;
}
