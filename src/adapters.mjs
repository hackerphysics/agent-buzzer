import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { shortSummary } from "./card.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { eventText, eventTime } from "./webhook.mjs";
import { modelMetadata } from "./model-metadata.mjs";
import { summaryKey } from "./i18n.mjs";

export function eventMetadata(input, details, metadata = {}) {
  const supplied = modelMetadata(input);
  const captured = supplied.model && metadata.model && supplied.model !== metadata.model ? {} : metadata;
  return {
    sessionId: eventText(input.sessionId || input.session_id),
    sessionName: eventText(input.sessionName || input.session_name || input.session_title, 256),
    turnId: eventText(input.turnId || input.turn_id),
    resultDetails: eventText(details, 8000),
    occurredAt: eventTime(input.occurredAt || input.occurred_at || input.completed_at, new Date().toISOString()),
    ...captured,
    ...supplied,
  };
}

function text(value, fallback) {
  return shortSummary(value, fallback);
}

function summaryFields(value, fallback) {
  return { summary: text(value, fallback), ...(!String(value || "").trim() ? { summaryKey: fallback } : {}) };
}

export function fromCodexStop(input) {
  return {
    agent: "Codex",
    status: "completed",
    ...summaryFields(input.last_assistant_message, "本轮任务已结束"),
    key: input.turn_id || input.session_id,
    ...eventMetadata(input, input.last_assistant_message, codexMetadata(input)),
  };
}

export function fromCodexPermission(input) {
  return {
    agent: "Codex",
    status: "needs_input",
    ...summaryFields(input.tool_input?.description, "有操作需要你批准"),
    key: input.turn_id || input.session_id,
    ...eventMetadata(input, input.tool_input?.description, codexMetadata(input)),
  };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join(" ");
  }
  return typeof content?.text === "string" ? content.text : "";
}

function transcriptEvents(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return [];
  let file;
  try {
    if (!statSync(transcriptPath).isFile()) return [];
    file = openSync(transcriptPath, "r");
    const size = fstatSync(file).size;
    const start = Math.max(0, size - 512 * 1024);
    const bytes = Buffer.alloc(size - start);
    readSync(file, bytes, 0, bytes.length, start);
    const lines = bytes.toString("utf8").split(/\r?\n/);
    if (start) lines.shift();
    const parsed = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event && typeof event === "object" && !Array.isArray(event)) parsed.push(event);
      } catch {
        // The tail may begin or end in the middle of a JSONL record.
      }
    }
    return parsed;
  } catch {
    return [];
  } finally {
    if (file !== undefined) closeSync(file);
  }
}

function codexMetadata(input) {
  const events = transcriptEvents(input.transcript_path || input.transcriptPath);
  let start = events.findLastIndex((event) => event.type === "event_msg" && ["task_started", "turn_started"].includes(event.payload?.type));
  if (start < 0) start = events.findLastIndex((event) => event.type === "turn_context");
  if (start < 0) return {};
  const turnId = input.turn_id || input.turnId;
  if (turnId && events[start].payload?.turn_id && events[start].payload.turn_id !== turnId) return {};
  let metadata = {};
  for (const event of events.slice(start)) {
    const payload = event.payload;
    if (event.type === "turn_context") {
      metadata = { ...metadata, ...modelMetadata({ model: payload?.model }) };
    } else if (event.type === "event_msg" && payload?.type === "token_count") {
      // Last-call usage is a context snapshot; total_token_usage is cumulative.
      const usage = modelMetadata({ contextTokens: payload.info?.last_token_usage?.total_tokens, contextWindow: payload.info?.model_context_window });
      metadata = { ...(metadata.model ? { model: metadata.model } : {}), ...usage };
    }
  }
  return metadata;
}

function copilotMetadata(input) {
  const events = transcriptEvents(input.transcriptPath || input.transcript_path);
  const start = events.findLastIndex((event) => event.type === "assistant.turn_start");
  if (start < 0 || ((input.turnId || input.turn_id) && events[start].data?.turnId && events[start].data.turnId !== (input.turnId || input.turn_id))) return {};
  let metadata = {};
  for (const event of events.slice(start)) {
    if (event.type === "assistant.usage") metadata = { ...metadata, ...modelMetadata({ model: event.data?.model }) };
    if (event.type === "session.usage_info") {
      const usage = modelMetadata({ contextTokens: event.data?.currentTokens, contextWindow: event.data?.tokenLimit });
      metadata = { ...(metadata.model ? { model: metadata.model } : {}), ...usage };
    }
  }
  return metadata;
}

export function lastCopilotReply(transcriptPath) {
  const events = transcriptEvents(transcriptPath);
  const lastStart = events.findLastIndex((event) => event.type === "assistant.turn_start");
  for (let i = events.length - 1; i > lastStart; i--) {
    const event = events[i];
    if (event.type !== "assistant.message") continue;
    const value = contentText(event.data?.content);
    if (value.trim()) return value;
  }
  return "";
}

export async function waitForCopilotReply(path, attempts = 80, delayMs = 150) {
  if (!path) return "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reply = lastCopilotReply(path);
    if (reply) return reply;
    await sleep(delayMs);
  }
  return "";
}

export function fromCopilotStop(input, reply = lastCopilotReply(input.transcriptPath || input.transcript_path)) {
  return {
    agent: "GitHub Copilot",
    status: "completed",
    ...summaryFields(reply, "本轮任务已结束"),
    key: input.sessionId || input.session_id,
    ...eventMetadata(input, reply, copilotMetadata(input)),
  };
}

export function fromCopilotNotification(input) {
  if (!["permission_prompt", "elicitation_dialog"].includes(input.notification_type)) return null;
  return {
    agent: "GitHub Copilot",
    status: "needs_input",
    ...summaryFields(input.message, "Copilot 正在等待你处理"),
    key: input.sessionId || input.session_id,
    ...eventMetadata(input, input.message, copilotMetadata(input)),
  };
}

export function fromHermes(input) {
  if (!["completed", "needs_input", "failed"].includes(input.status)) {
    throw new Error("Unsupported Hermes event status");
  }
  return {
    agent: "Hermes",
    status: input.status,
    ...summaryFields(input.summary, input.status === "needs_input" ? "Hermes 正在等待你处理" : "本轮任务已结束"),
    ...(summaryKey(input.summaryKey) ? { summaryKey: input.summaryKey } : {}),
    key: input.turn_id || input.session_id,
    ...eventMetadata(input, input.resultDetails ?? input.summary),
  };
}
