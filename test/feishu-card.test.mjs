import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildCard } from "../src/card.mjs";
import { fromCodexStop, fromCopilotStop, fromHermes } from "../src/adapters.mjs";
import { modelMetadata } from "../src/model-metadata.mjs";
import { sendChannel } from "../src/channels.mjs";
import { saveSettings } from "../src/config.mjs";
import { listEntries, makeEntry, persistEntry } from "../src/queue.mjs";
import { createService } from "../src/service.mjs";

const occurredAt = "2026-10-12T08:00:00.000Z";
const event = { agent: "Codex", status: "completed", summary: "Done", sessionName: "Update settings", occurredAt, model: "gpt-example", contextTokens: 24000, contextWindow: 128000 };

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-card-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-card-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, env: { AGENTBUZZER_CONFIG: join(dir, "config.json") } };
}

test("Feishu card places session name in subtitle and known metadata in a muted final footer", () => {
  const card = buildCard({ ...event, url: "https://example.com/task" }, "Office-PC");
  assert.equal(card.header.subtitle.content, "Update settings");
  assert.equal(card.header.subtitle.tag, "plain_text");
  assert.equal(card.body.elements[0].content, "Done");
  assert.equal(card.body.elements.at(-2).tag, "button");
  const footer = card.body.elements.at(-1);
  assert.equal(footer.tag, "div");
  assert.equal(footer.text.tag, "plain_text");
  assert.equal(footer.text.text_size, "notation");
  assert.equal(footer.text.text_color, "grey");
  assert.match(footer.text.content, /AgentBuzzer · Office-PC/);
  assert.match(footer.text.content, /完成时间：/);
  assert.match(footer.text.content, /Model: gpt-example/);
  assert.match(footer.text.content, /Context: 24,000 \/ 128,000 tokens \(18\.8%\)/);
  const expectedTime = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(occurredAt));
  assert.ok(footer.text.content.includes(expectedTime));
});

test("cards omit unavailable metadata and never turn permission time into a completion time", () => {
  const bare = buildCard({ agent: "Hermes", status: "completed", summary: "Done", sessionId: "id-only" });
  assert.equal(bare.header.subtitle, undefined);
  assert.equal(bare.body.elements.at(-1).text.content, "AgentBuzzer");
  const waiting = buildCard({ ...event, status: "needs_input" }, "Office-PC");
  assert.match(waiting.body.elements.at(-1).text.content, /发生时间：/);
  assert.doesNotMatch(waiting.body.elements.at(-1).text.content, /完成时间/);
  assert.match(buildCard({ ...event, status: "failed" }, "PC").body.elements.at(-1).text.content, /结束时间：/);
  const fallback = buildCard({ agent: "Codex", status: "completed", occurredAt: "bad" }, "PC", { createdAt: occurredAt });
  assert.match(fallback.body.elements.at(-1).text.content, /完成时间：/);
  const invalid = buildCard({ ...event, model: {}, contextTokens: -1, contextWindow: 0, contextPercent: Infinity }, "PC");
  assert.doesNotMatch(invalid.body.elements.at(-1).text.content, /Model:|Context:|NaN|undefined/);
  assert.match(buildCard({ ...event, contextTokens: 0 }, "PC").body.elements.at(-1).text.content, /Context: 0 \/ 128,000 tokens \(0%\)/);
  assert.match(buildCard({ ...event, contextWindow: undefined }, "PC").body.elements.at(-1).text.content, /Context: 24,000 tokens/);
  assert.match(buildCard({ ...event, contextWindow: undefined, contextPercent: 18.8 }, "PC").body.elements.at(-1).text.content, /Context: 24,000 tokens \(18.8%\)/);
  assert.match(buildCard({ ...event, contextTokens: undefined }, "PC").body.elements.at(-1).text.content, /Context 窗口: 128,000 tokens/);
  assert.match(buildCard({ ...event, contextTokens: undefined, contextPercent: 18.8 }, "PC").body.elements.at(-1).text.content, /Context 窗口: 128,000 tokens \(18.8%\)/);
  assert.match(buildCard({ agent: "Hermes", status: "completed", contextPercent: 18.85 }, "PC").body.elements.at(-1).text.content, /Context: 18.9%/);
});

test("model metadata accepts only bounded typed values and not cumulative usage", () => {
  assert.deepEqual(modelMetadata({ model: " gpt\n-example ", context_tokens: 0, context_window: 128000, context_percent: 0 }), { model: "gpt -example", contextTokens: 0, contextWindow: 128000, contextPercent: 0 });
  assert.deepEqual(modelMetadata({ model_name: "hermes-example", context: { currentTokens: 123, tokenLimit: 1000 } }), { model: "hermes-example", contextTokens: 123, contextWindow: 1000 });
  assert.deepEqual(modelMetadata({ usage: { total_tokens: 1234 }, model: {}, contextTokens: "123", contextWindow: true, contextPercent: -1 }), {});
  assert.equal(modelMetadata({ model: "x".repeat(500) }).model.length, 180);
});

test("application and signed custom bot send identical interactive card layouts", async () => {
  const cards = [];
  let calls = 0;
  await sendChannel("feishu", { appId: "id", appSecret: "secret", receiveId: "recipient", receiveIdType: "chat_id" }, event, "Office-PC", async (_url, init) => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ code: 0, tenant_access_token: "token" }) };
    const payload = JSON.parse(init.body);
    assert.equal(payload.msg_type, "interactive");
    cards.push(JSON.parse(payload.content));
    return { ok: true, json: async () => ({ code: 0, data: { message_id: "msg" } }) };
  });
  await sendChannel("feishuBot", { url: "https://open.feishu.cn/open-apis/bot/v2/hook/fake", signingSecret: "signing-secret" }, event, "Office-PC", async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.msg_type, "interactive");
    assert.ok(payload.timestamp && payload.sign);
    assert.ok(!payload.content);
    cards.push(payload.card);
    return { ok: true, json: async () => ({ code: 0 }) };
  });
  assert.deepEqual(cards[0], cards[1]);
});

test("Codex reads latest-turn model and last usage snapshot, not session totals", (t) => {
  const { dir } = workspace(t);
  const path = join(dir, "codex.jsonl");
  const records = [
    { type: "event_msg", payload: { type: "task_started", turn_id: "old" } },
    { type: "turn_context", payload: { turn_id: "old", model: "old-model" } },
    { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 555 }, model_context_window: 1000 } } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "new" } },
    { type: "turn_context", payload: { turn_id: "new", model: "gpt-example" } },
    { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 999999 }, last_token_usage: { total_tokens: 24000 }, model_context_window: 128000 } } },
  ];
  writeFileSync(path, records.map(JSON.stringify).join("\n") + "\n{incomplete");
  const adapted = fromCodexStop({ transcript_path: path, turn_id: "new" });
  assert.deepEqual(modelMetadata(adapted), { model: "gpt-example", contextTokens: 24000, contextWindow: 128000 });
  assert.deepEqual(modelMetadata(fromCodexStop({ transcript_path: path, turn_id: "new", model: "different-model" })), { model: "different-model" });
  assert.deepEqual(modelMetadata(fromCodexStop({ transcript_path: path, turn_id: "different" })), {});
  writeFileSync(path, records.slice(0, -1).map(JSON.stringify).join("\n"));
  assert.deepEqual(modelMetadata(fromCodexStop({ transcript_path: path, turn_id: "new" })), { model: "gpt-example" });
  assert.deepEqual(modelMetadata(fromCodexStop({ transcript_path: "missing", model: "direct" })), { model: "direct" });
});

test("Copilot reads current context usage; a new turn does not inherit stale statistics", (t) => {
  const { dir } = workspace(t);
  const path = join(dir, "copilot.jsonl");
  const records = [
    { type: "assistant.turn_start", data: { turnId: "old" } },
    { type: "assistant.usage", data: { model: "old-model" } },
    { type: "session.usage_info", data: { currentTokens: 444, tokenLimit: 1000 } },
    { type: "assistant.turn_start", data: { turnId: "new" } },
    { type: "assistant.message", data: { content: "Done" } },
    { type: "assistant.usage", data: { model: "copilot-model", inputTokens: 999999, outputTokens: 100 } },
    { type: "session.usage_info", data: { currentTokens: 24000, tokenLimit: 128000 } },
  ];
  writeFileSync(path, records.map(JSON.stringify).join("\n"));
  assert.deepEqual(modelMetadata(fromCopilotStop({ transcriptPath: path })), { model: "copilot-model", contextTokens: 24000, contextWindow: 128000 });
  writeFileSync(path, records.slice(0, 5).map(JSON.stringify).join("\n"));
  assert.deepEqual(modelMetadata(fromCopilotStop({ transcriptPath: path })), {});
  assert.deepEqual(modelMetadata(fromHermes({ status: "completed", model: "hermes-model" })), { model: "hermes-model" });
  writeFileSync(path, "null\n[]\n{}\n");
  assert.deepEqual(modelMetadata(fromCopilotStop({ transcriptPath: path })), {});
});

test("queued cards retain captured metadata and original timestamp after DND/restart", async (t) => {
  const { env } = workspace(t);
  saveSettings({ notifications: { dnd: true }, channels: { feishu: { enabled: false }, feishuBot: { enabled: true, url: "https://open.feishu.cn/open-apis/bot/v2/hook/fake" } } }, env);
  let service = createService({ env, intervalMs: 100000, now: () => new Date(occurredAt) });
  await service.start(0);
  await service.accept(event);
  await service.close();
  const queued = listEntries(env)[0];
  assert.deepEqual(modelMetadata(queued.event), modelMetadata(event));
  const expected = buildCard(queued.event, queued.deviceName);
  let actual;
  service = createService({ env, intervalMs: 100000, now: () => new Date("2026-10-13T08:00:00Z"), deliver: async (_channel, _config, delivered, device, _fetch, context) => { actual = buildCard(delivered, device, context); } });
  t.after(() => service.close());
  await service.start(0);
  service.updateSettings({ notifications: { dnd: false } });
  for (let i = 0; i < 100 && listEntries(env).length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(actual, expected);
  assert.equal(listEntries(env).length, 0);
  const offline = makeEntry({ ...event, contextTokens: -1 });
  persistEntry(offline, env);
  assert.equal(listEntries(env)[0].event.contextTokens, undefined);
});
