import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eventText } from "./webhook.mjs";

const MAX_INDEX_BYTES = 8 * 1024 * 1024;

async function readIndexTail(path, { signal }) {
  const info = await stat(path);
  signal.throwIfAborted();
  if (!info.isFile() || !info.size) return "";
  const start = Math.max(0, info.size - MAX_INDEX_BYTES);
  const stream = createReadStream(path, { start, end: info.size - 1, encoding: "utf8", signal });
  let value = "";
  for await (const chunk of stream) value += chunk;
  // The bounded tail may start inside a UTF-8 character or a JSONL record.
  if (start) return value.includes("\n") ? value.slice(value.indexOf("\n") + 1) : "";
  return value;
}

export async function resolveCodexSessionName(sessionId, { env = process.env, timeoutMs = 750, readIndex = readIndexTail } = {}) {
  if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 512) return "";
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(""); }, timeoutMs);
  });
  try {
    const lookup = async () => {
      const path = join(env.CODEX_HOME || join(homedir(), ".codex"), "session_index.jsonl");
      const value = await readIndex(path, { signal: controller.signal });
      if (controller.signal.aborted) return "";
      const lines = value.split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const record = JSON.parse(lines[index]);
          if (record?.id === sessionId && typeof record.thread_name === "string") {
            return eventText(record.thread_name.replace(/[\x00-\x1f\x7f]/g, " "), 256);
          }
        } catch { /* Ignore malformed or partially written index records. */ }
      }
      return "";
    };
    return await Promise.race([lookup(), deadline]);
  } catch {
    // This is optional local metadata, not a prerequisite for notification delivery.
    return "";
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
