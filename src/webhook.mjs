export const WEBHOOK_FIELDS = [
  { name: "deviceName", label: "设备名称" },
  { name: "agentName", label: "Agent 名称" },
  { name: "appName", label: "通知 App 名称" },
  { name: "sessionName", label: "会话名称" },
  { name: "resultDetails", label: "结果详情" },
  { name: "completedAt", label: "完成时间" },
  { name: "eventId", label: "事件 ID" },
  { name: "sessionId", label: "会话 ID" },
  { name: "turnId", label: "轮次 ID" },
  { name: "status", label: "任务状态" },
  { name: "occurredAt", label: "发生时间" },
  { name: "schemaVersion", label: "接口版本" },
];

const NAMES = new Set(WEBHOOK_FIELDS.map(({ name }) => name));
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

export function validateMapping(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Webhook field mapping");
  const mapping = {};
  for (const [source, target] of Object.entries(value)) {
    if (!NAMES.has(source) || typeof target !== "string") throw new Error("Invalid Webhook field mapping");
    const path = target.trim() || source;
    const parts = path.split(".");
    if (path.length > 200 || parts.length > 8 || parts.some((part) => !part || /[\s\[\]\x00-\x1f\x7f]/u.test(part) || UNSAFE.has(part))) throw new Error(`Invalid Webhook path: ${source}`);
    mapping[source] = path;
  }
  const paths = WEBHOOK_FIELDS.map(({ name }) => mapping[name] || name);
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (paths[i] === paths[j] || paths[i].startsWith(`${paths[j]}.`) || paths[j].startsWith(`${paths[i]}.`)) throw new Error(`Conflicting Webhook paths: ${paths[i]}, ${paths[j]}`);
    }
  }
  return mapping;
}

export function eventText(value, limit = 512) {
  return typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, limit) : "";
}

export function eventTime(value, fallback) {
  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function webhookMessage(event, deviceName, context = {}) {
  const occurredAt = eventTime(event.occurredAt, eventTime(context.createdAt, null));
  const sessionId = eventText(event.sessionId);
  return {
    deviceName,
    agentName: event.agent,
    appName: "AgentBuzzer",
    sessionName: eventText(event.sessionName, 256) || sessionId || "",
    resultDetails: eventText(event.resultDetails, 8000) || eventText(event.summary, 8000),
    completedAt: event.status === "needs_input" ? null : occurredAt,
    eventId: context.deliveryId || "",
    sessionId,
    turnId: eventText(event.turnId),
    status: event.status,
    occurredAt,
    schemaVersion: 1,
  };
}

export function mapWebhookMessage(message, value) {
  const mapping = validateMapping(value);
  const result = {};
  for (const { name } of WEBHOOK_FIELDS) {
    const parts = (mapping[name] || name).split(".");
    let parent = result;
    for (const part of parts.slice(0, -1)) parent = Object.hasOwn(parent, part) ? parent[part] : (parent[part] = {});
    parent[parts.at(-1)] = message[name];
  }
  return result;
}

export function webhookPayload(config, event, deviceName, context) {
  if (config.payloadFormat === "legacy") return { event, deviceName };
  return mapWebhookMessage(webhookMessage(event, deviceName, context), config.fieldMapping);
}
