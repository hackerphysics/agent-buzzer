import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { shortSummary } from "./card.mjs";

function text(value, fallback) {
  return shortSummary(value, fallback);
}

export function fromCodexStop(input) {
  return {
    agent: "Codex",
    status: "completed",
    summary: text(input.last_assistant_message, "本轮任务已结束"),
    key: input.turn_id || input.session_id,
  };
}

export function fromCodexPermission(input) {
  return {
    agent: "Codex",
    status: "needs_input",
    summary: text(input.tool_input?.description, "有操作需要你批准"),
    key: input.turn_id || input.session_id,
  };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join(" ");
  }
  return typeof content?.text === "string" ? content.text : "";
}

export function lastCopilotReply(transcriptPath) {
  if (!transcriptPath) return "";
  let file;
  try {
    file = openSync(transcriptPath, "r");
    const size = fstatSync(file).size;
    const start = Math.max(0, size - 512 * 1024);
    const bytes = Buffer.alloc(size - start);
    readSync(file, bytes, 0, bytes.length, start);
    const lines = bytes.toString("utf8").split(/\r?\n/);
    if (start) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (event.type !== "assistant.message") continue;
        const value = contentText(event.data?.content);
        if (value.trim()) return value;
      } catch {
        // An incomplete trailing JSONL record does not hide earlier messages.
      }
    }
  } catch {
    return "";
  } finally {
    if (file !== undefined) closeSync(file);
  }
  return "";
}

export function fromCopilotStop(input) {
  return {
    agent: "Copilot CLI",
    status: "completed",
    summary: text(lastCopilotReply(input.transcriptPath || input.transcript_path), "本轮任务已结束"),
    key: input.sessionId || input.session_id,
  };
}

export function fromCopilotNotification(input) {
  if (!["permission_prompt", "elicitation_dialog"].includes(input.notification_type)) return null;
  return {
    agent: "Copilot CLI",
    status: "needs_input",
    summary: text(input.message, "Copilot 正在等待你处理"),
    key: input.sessionId || input.session_id,
  };
}

export function fromHermes(input) {
  if (!["completed", "needs_input", "failed"].includes(input.status)) {
    throw new Error("Unsupported Hermes event status");
  }
  return {
    agent: "Hermes",
    status: input.status,
    summary: text(input.summary, input.status === "needs_input" ? "Hermes 正在等待你处理" : "本轮任务已结束"),
    key: input.turn_id || input.session_id,
  };
}
