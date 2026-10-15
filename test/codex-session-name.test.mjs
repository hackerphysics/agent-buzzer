import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCodexSessionName } from "../src/codex-session-name.mjs";
import { fromCodexPermission, fromCodexStop } from "../src/adapters.mjs";
import { createService } from "../src/service.mjs";
import { saveSettings } from "../src/config.mjs";
import { listEntries, makeEntry, persistEntry } from "../src/queue.mjs";
import { buildCard } from "../src/card.mjs";
import { webhookMessage } from "../src/webhook.mjs";

function fixture(t, { dnd = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-names-"));
  const env = { AGENTBUZZER_CONFIG: join(dir, "config.json"), CODEX_HOME: join(dir, "User's Codex \u4e2d\u6587") };
  mkdirSync(env.CODEX_HOME);
  const index = join(env.CODEX_HOME, "session_index.jsonl");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  saveSettings({ notifications: { dnd }, channels: {
    feishu: { enabled: false }, feishuBot: { enabled: true, url: "https://open.feishu.cn/open-apis/bot/v2/hook/fake" },
  } }, env);
  return { env, index };
}

const record = (id, name) => JSON.stringify({ id, thread_name: name, updated_at: "2026-10-15T08:00:00Z" }) + "\n";
const stop = (sessionId = "thread-one") => fromCodexStop({ session_id: sessionId, turn_id: "turn-one", last_assistant_message: "Done" });

async function eventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for session metadata or delivery");
}

test("Codex index lookup matches the exact session and follows the latest rename", async (t) => {
  const { env, index } = fixture(t);
  writeFileSync(index, record("thread-one", "Old name") + record("thread-other", "Unrelated") + "null\n[]\n{broken\n" + record("thread-one", "\u6211\u7684\u4f1a\u8bdd") + '{"id":"thread-one","thread_name":');
  assert.equal(await resolveCodexSessionName("thread-one", { env }), "\u6211\u7684\u4f1a\u8bdd");
  assert.equal(await resolveCodexSessionName("thread", { env }), "");
  appendFileSync(index, "\n" + record("thread-one", " Renamed\n\0title "));
  assert.equal(await resolveCodexSessionName("thread-one", { env }), "Renamed  title");
  appendFileSync(index, record("thread-one", ""));
  assert.equal(await resolveCodexSessionName("thread-one", { env }), "", "Clearing a name must not resurrect an older one");
});

test("missing, unreadable, or malformed indexes never invent a thread name", async (t) => {
  const { env, index } = fixture(t);
  assert.equal(await resolveCodexSessionName("thread-one", { env }), "");
  writeFileSync(index, 'null\n[]\n{"id":"thread-one","thread_name":{}}\n');
  assert.equal(await resolveCodexSessionName("thread-one", { env }), "");
  assert.equal(await resolveCodexSessionName("thread-one", { env, readIndex: async () => { throw new Error("private path or permission error"); } }), "");
  let calls = 0;
  for (const id of [null, {}, "", " ", "x".repeat(513)]) {
    assert.equal(await resolveCodexSessionName(id, { readIndex: async () => { calls++; return ""; } }), "");
  }
  assert.equal(calls, 0);
});

test("index reads are bounded and ignore a truncated first record", async (t) => {
  const { env, index } = fixture(t);
  writeFileSync(index, record("old-thread", "Outside the bounded tail") + "x".repeat(8 * 1024 * 1024) + "\n" + record("thread-one", "x".repeat(300)));
  assert.equal((await resolveCodexSessionName("thread-one", { env, timeoutMs: 5000 })).length, 256);
  assert.equal(await resolveCodexSessionName("old-thread", { env, timeoutMs: 5000 }), "");
});

test("slow metadata lookup has a deadline and cancels its reader", async () => {
  let cancelled = false;
  const started = Date.now();
  const name = await resolveCodexSessionName("thread-one", { timeoutMs: 25, readIndex: (_path, { signal }) => {
    signal.addEventListener("abort", () => { cancelled = true; });
    return new Promise(() => {});
  } });
  assert.equal(name, "");
  assert.equal(cancelled, true);
  assert.ok(Date.now() - started < 1000);
});

test("HTTP acknowledges the durable event before awaiting a session name", async (t) => {
  const { env } = fixture(t);
  let finish;
  let resolving = false;
  const pending = new Promise((resolve) => { finish = resolve; });
  const delivered = [];
  const service = createService({ env, intervalMs: 100000, resolveCodexName: () => { resolving = true; return pending; }, deliver: async (_channel, _config, event) => { delivered.push(event); } });
  t.after(async () => { finish(""); await service.close(); });
  const port = await service.start(0);
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stop()), signal: AbortSignal.timeout(2000),
  });
  assert.equal((await response.json()).disposition, "queued");
  await eventually(() => resolving);
  assert.equal(listEntries(env).length, 1);
  assert.equal(delivered.length, 0);
  finish("Actual thread name");
  await eventually(() => delivered.length === 1);
  assert.equal(delivered[0].sessionName, "Actual thread name");
});

test("DND captures names once; renames affect new events, not restart or replay", async (t) => {
  const { env, index } = fixture(t, { dnd: true });
  writeFileSync(index, record("thread-one", "Original name"));
  let service = createService({ env, intervalMs: 100000 });
  t.after(async () => service.close());
  await service.start(0);
  const original = stop();
  await service.accept(original);
  await eventually(() => listEntries(env)[0]?.event.sessionName === "Original name");
  appendFileSync(index, record("thread-one", "Renamed thread"));
  await service.accept(fromCodexPermission({ session_id: "thread-one", turn_id: "turn-two" }));
  await eventually(() => listEntries(env).length === 2 && listEntries(env).every((entry) => entry.sessionNameResolved));
  const before = listEntries(env).map((entry) => ({ id: entry.id, event: entry.event }));
  await service.close();
  const cards = [];
  service = createService({ env, intervalMs: 100000, deliver: async (_channel, _config, event, device, _fetch, context) => { cards.push(buildCard(event, device, context)); } });
  await service.start(0);
  assert.deepEqual(listEntries(env).map((entry) => ({ id: entry.id, event: entry.event })), before);
  service.updateSettings({ notifications: { dnd: false } });
  await eventually(() => cards.length === 2 && !listEntries(env).length);
  assert.deepEqual(cards.map((card) => card.header.subtitle.content), ["Original name", "Renamed thread"]);
  assert.equal(before[0].event.occurredAt, original.occurredAt, "Original completion time must remain captured");
});

test("offline queued events get real names before both cards and webhooks are formatted", async (t) => {
  const { env, index } = fixture(t);
  writeFileSync(index, record("thread-one", "Recovered task"));
  const event = stop();
  const entry = makeEntry(event, Date.now(), ["feishuBot"]);
  persistEntry(entry, env);
  let card, message;
  const service = createService({ env, intervalMs: 100000, deliver: async (_channel, _config, delivered, device, _fetch, context) => {
    card = buildCard(delivered, device, context);
    message = webhookMessage(delivered, device, context);
  } });
  t.after(async () => service.close());
  await service.start(0);
  assert.equal(card.header.subtitle.content, "Recovered task");
  assert.equal(message.sessionName, "Recovered task");
  assert.equal(message.appName, "AgentBuzzer", "Card branding removal must not change the Webhook contract");
  assert.equal(message.occurredAt, event.occurredAt);
  assert.equal(message.eventId, entry.id);
});

test("explicit names, other agents, and missing session ids do not trigger a lookup", async (t) => {
  const { env } = fixture(t);
  const delivered = [];
  const service = createService({ env, intervalMs: 100000, resolveCodexName: () => assert.fail("Unexpected name lookup"), deliver: async (_channel, _config, event) => { delivered.push(event); } });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept({ ...stop(), sessionName: "Supplied title" });
  await service.accept({ ...stop(), agent: "Hermes" });
  await service.accept({ ...stop(), sessionId: "" });
  await eventually(() => delivered.length === 3);
  assert.equal(delivered[0].sessionName, "Supplied title");
  assert.equal(buildCard(delivered[2], "PC").header.subtitle, undefined);
});

test("turning notifications off during lookup cannot resurrect or deliver the entry", async (t) => {
  const { env } = fixture(t);
  let finish;
  let resolving = false;
  const pending = new Promise((resolve) => { finish = resolve; });
  const service = createService({ env, intervalMs: 100000, resolveCodexName: () => { resolving = true; return pending; }, deliver: async () => assert.fail("Disabled notifications must not send") });
  t.after(async () => { finish(""); await service.close(); });
  await service.start(0);
  await service.accept(stop());
  await eventually(() => resolving);
  service.updateSettings({ notifications: { enabled: false } });
  assert.equal(listEntries(env).length, 0);
  service.updateSettings({ notifications: { enabled: true } });
  finish("Late result");
  await new Promise((resolve) => setImmediate(resolve));
  await service.pump();
  assert.equal(listEntries(env).length, 0);
});

test("unavailable title metadata never counts as a channel delivery failure", async (t) => {
  const { env } = fixture(t);
  const cards = [];
  const service = createService({ env, intervalMs: 100000,
    resolveCodexName: (id, options) => resolveCodexSessionName(id, { ...options, timeoutMs: 20, readIndex: () => new Promise(() => {}) }),
    deliver: async (_channel, _config, event, device) => { cards.push(buildCard(event, device)); },
  });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(stop());
  await eventually(() => cards.length === 1 && !listEntries(env).length);
  assert.equal(cards[0].header.subtitle, undefined);
});

test("channel switches made during name lookup are preserved", async (t) => {
  const { env } = fixture(t);
  saveSettings({ channels: { feishu: { enabled: false }, feishuBot: { enabled: true, url: "https://open.feishu.cn/open-apis/bot/v2/hook/fake" }, webhook: { enabled: true, url: "https://example.test/hook" } } }, env);
  let finish;
  let resolving = false;
  const pending = new Promise((resolve) => { finish = resolve; });
  const channels = [];
  const service = createService({ env, intervalMs: 100000, resolveCodexName: () => { resolving = true; return pending; }, deliver: async (channel) => { channels.push(channel); } });
  t.after(async () => { finish(""); await service.close(); });
  await service.start(0);
  await service.accept(stop());
  await eventually(() => resolving);
  service.updateSettings({ channels: { webhook: { enabled: false } } });
  finish("Resolved after channel switch");
  await eventually(() => channels.length === 1 && !listEntries(env).length);
  assert.deepEqual(channels, ["feishuBot"]);
});

test("delivery retries keep the resolved name even after the thread is renamed", async (t) => {
  const { env, index } = fixture(t);
  writeFileSync(index, record("thread-one", "Captured title"));
  let time = Date.now();
  const names = [];
  const service = createService({ env, intervalMs: 100000, now: () => new Date(time), deliver: async (_channel, _config, event) => {
    names.push(event.sessionName);
    if (names.length === 1) throw new Error("offline");
  } });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(stop());
  await eventually(() => listEntries(env)[0]?.attempts === 1);
  appendFileSync(index, record("thread-one", "A later title"));
  time += 5000;
  await service.pump();
  assert.deepEqual(names, ["Captured title", "Captured title"]);
  assert.equal(listEntries(env).length, 0);
});
