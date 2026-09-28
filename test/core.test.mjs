import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCard, shortSummary } from "../src/card.mjs";
import { fromCodexPermission, fromCodexStop, fromCopilotNotification, fromCopilotStop, fromHermes } from "../src/adapters.mjs";
import { sendCard } from "../src/feishu.mjs";

test("card is an interactive Feishu card with device, status and short summary", () => {
  const card = buildCard({ agent: "Codex", status: "needs_input", summary: "请批准执行" }, "Office-PC");
  assert.equal(card.schema, "2.0");
  assert.match(card.header.title.content, /等待你处理/);
  assert.match(card.header.subtitle.content, /Office-PC/);
  assert.equal(card.body.elements[0].content, "请批准执行");
  assert.equal(shortSummary("x".repeat(300)).length, 160);
  assert.equal(card.body.elements.length, 1);
  const linked = buildCard({ agent: "Codex", status: "completed", summary: "完成", url: "https://example.com/task" }, "Office-PC");
  assert.equal(linked.body.elements[1].behaviors[0].type, "open_url");
});

test("Codex turn and approval events stay separate", () => {
  assert.deepEqual(fromCodexStop({ turn_id: "t1", last_assistant_message: "已经完成" }), {
    agent: "Codex", status: "completed", summary: "已经完成", key: "t1",
  });
  assert.equal(fromCodexPermission({ turn_id: "t1", tool_input: { description: "需要权限" } }).status, "needs_input");
});

test("Copilot reads only the last assistant reply from JSONL transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-test-"));
  try {
    const path = join(dir, "events.jsonl");
    writeFileSync(path, [
      { type: "assistant.message", data: { content: "Old reply" } },
      { type: "assistant.message", data: { content: "Final reply" } },
      { type: "assistant.turn_end", data: {} },
    ].map((item) => JSON.stringify(item)).join("\n"));
    assert.equal(fromCopilotStop({ sessionId: "s1", transcriptPath: path }).summary, "Final reply");
    assert.equal(fromCopilotStop({ sessionId: "s1", transcriptPath: "missing" }).summary, "本轮任务已结束");
  } finally {
    if (dir.startsWith(`${tmpdir()}${process.platform === "win32" ? "\\" : "/"}agent-buzzer-test-`)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.equal(fromCopilotNotification({ notification_type: "permission_prompt", message: "Approval needed" }).status, "needs_input");
  assert.equal(fromCopilotNotification({ notification_type: "agent_completed" }), null);
});

test("Hermes adapter accepts completion, failure, and approval", () => {
  assert.equal(fromHermes({ status: "completed", summary: "做完了" }).summary, "做完了");
  assert.equal(fromHermes({ status: "failed" }).status, "failed");
  assert.equal(fromHermes({ status: "needs_input" }).status, "needs_input");
  assert.throws(() => fromHermes({ status: "unexpected" }));
});

test("Feishu client obtains tenant token and sends an interactive card", async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => requests.length === 1
      ? { code: 0, tenant_access_token: "token" }
      : { code: 0, data: { message_id: "msg-1" } } };
  };
  const id = await sendCard({ appId: "app", appSecret: "secret", receiveIdType: "open_id", receiveId: "ou_123" }, buildCard({ agent: "Hermes", status: "completed", summary: "Done" }, "PC"), fakeFetch);
  assert.equal(id, "msg-1");
  assert.equal(JSON.parse(requests[0].init.body).app_secret, "secret");
  const sent = JSON.parse(requests[1].init.body);
  assert.equal(sent.msg_type, "interactive");
  assert.equal(sent.receive_id, "ou_123");
  assert.equal(JSON.parse(sent.content).schema, "2.0");
  assert.equal(requests[1].init.headers.Authorization, "Bearer token");
});
