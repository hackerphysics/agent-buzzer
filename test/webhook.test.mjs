import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fromCodexStop, fromCodexPermission, fromCopilotStop, fromHermes } from "../src/adapters.mjs";
import { loadChannelConfig, safeChannelSettings, saveSettings } from "../src/config.mjs";
import { sendChannel } from "../src/channels.mjs";
import { listEntries, makeEntry, persistEntry } from "../src/queue.mjs";
import { createService } from "../src/service.mjs";
import { WEBHOOK_FIELDS, mapWebhookMessage, validateMapping, webhookMessage, webhookPayload } from "../src/webhook.mjs";

const occurredAt = "2026-10-12T08:00:00.000Z";
const event = { agent: "Codex", status: "completed", summary: "Done", resultDetails: "Full result\nnext line", sessionId: "s1", sessionName: "Task One", turnId: "t1", occurredAt };
const context = { deliveryId: "id1", createdAt: "2026-10-12T08:01:00.000Z" };
const url = "https://example.com/hook";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-webhook-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-webhook-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { AGENTBUZZER_CONFIG: join(dir, "config.json") };
}

test("standard webhook contract and identity defaults preserve value types", () => {
  const payload = webhookPayload({}, event, "Office", context);
  assert.deepEqual(payload, { deviceName: "Office", agentName: "Codex", appName: "AgentBuzzer", sessionName: "Task One", resultDetails: "Full result\nnext line", completedAt: occurredAt, eventId: "id1", sessionId: "s1", turnId: "t1", status: "completed", occurredAt, schemaVersion: 1 });
  assert.deepEqual(Object.keys(payload), WEBHOOK_FIELDS.map(({ name }) => name));
  assert.deepEqual(webhookPayload({ fieldMapping: { deviceName: "  " } }, event, "Office", context), payload);
  assert.deepEqual(webhookPayload({ payloadFormat: "legacy" }, event, "Office", context), { event, deviceName: "Office" });
  const waiting = webhookMessage({ ...event, status: "needs_input", sessionName: "" }, "Office", context);
  assert.equal(waiting.completedAt, null);
  assert.equal(waiting.occurredAt, occurredAt);
  assert.equal(waiting.sessionName, "s1");
  assert.equal(webhookMessage({ ...event, status: "failed" }, "Office", context).completedAt, occurredAt);
  assert.equal(webhookMessage({ agent: "Hermes", status: "completed", summary: "Done" }, "Office", context).completedAt, context.createdAt);
  assert.equal(webhookMessage({ agent: "Hermes", status: "completed", summary: "Done" }, "Office").completedAt, null);
});

test("custom destinations support nesting and reject conflicts and prototype pollution", () => {
  const message = webhookMessage(event, "Office", context);
  const mapped = mapWebhookMessage(message, { deviceName: "metadata.device", resultDetails: "data.message", schemaVersion: "version", appName: "toString.name" });
  assert.equal(mapped.metadata.device, "Office");
  assert.equal(mapped.data.message, event.resultDetails);
  assert.equal(mapped.version, 1);
  assert.equal(mapped.toString.name, "AgentBuzzer");
  assert.ok(!Object.hasOwn(Object.prototype.toString, "name") || Object.prototype.toString.name === "toString");
  assert.ok(!Object.hasOwn(mapped, "deviceName"));
  for (const value of [null, [], "{}", { nope: "x" }, { deviceName: 123 }, { deviceName: "status" }, { deviceName: "data", appName: "data.app" }, { deviceName: "data.a", appName: "data.a" }, { deviceName: "data..x" }, { deviceName: "__proto__.polluted" }, { deviceName: "x.constructor.name" }, { deviceName: "prototype" }, { deviceName: "data[0]" }, { deviceName: "a\n" + "b" }, { deviceName: "a.".repeat(9) + "b" }]) assert.throws(() => validateMapping(value));
  assert.equal({}.polluted, undefined);
});

test("adapters and durable queue retain bounded full details and session metadata", (t) => {
  const env = workspace(t);
  const input = { session_id: "s1", session_title: "Task One", turn_id: "t1", occurred_at: occurredAt };
  const detail = "x".repeat(9000);
  for (const adapted of [fromCodexStop({ ...input, last_assistant_message: detail }), fromCopilotStop(input, detail), fromHermes({ ...input, status: "completed", summary: detail })]) {
    assert.equal(adapted.summary.length, 160);
    assert.equal(adapted.resultDetails.length, 8000);
    assert.equal(adapted.sessionName, "Task One");
    assert.equal(adapted.sessionId, "s1");
    assert.equal(adapted.turnId, "t1");
    assert.equal(adapted.occurredAt, occurredAt);
    persistEntry(makeEntry(adapted, Date.parse(context.createdAt), ["webhook"]), env);
  }
  assert.ok(listEntries(env).every(({ event }) => event.resultDetails.length === 8000 && event.occurredAt === occurredAt));
  assert.equal(webhookMessage(fromCodexPermission(input), "Office").completedAt, null);
  assert.equal(webhookMessage(fromCodexStop({}), "Office").resultDetails, "本轮任务已结束");
});

test("saved and encrypted legacy webhook settings migrate only on explicit selection", (t) => {
  const env = workspace(t);
  assert.equal(loadChannelConfig("webhook", env).payloadFormat, "standard");
  saveSettings({ channels: { webhook: { url } } }, env);
  assert.equal(loadChannelConfig("webhook", env).payloadFormat, "legacy");
  const service = createService({ env });
  service.updateSettings({ channels: { webhook: { url } } });
  assert.equal(safeChannelSettings(env).webhook.payloadFormat, "legacy");
  service.updateSettings({ channels: { webhook: { payloadFormat: "standard", fieldMapping: { deviceName: "device", resultDetails: "data.text" } } } });
  assert.equal(loadChannelConfig("webhook", env).payloadFormat, "standard");
  assert.equal(safeChannelSettings(env).webhook.fieldMapping.resultDetails, "data.text");
  assert.throws(() => service.updateSettings({ channels: { webhook: { fieldMapping: { agentName: "status" } } } }));
  assert.equal(loadChannelConfig("webhook", env).fieldMapping.deviceName, "device");
  assert.deepEqual(loadChannelConfig("webhook", { ...env, AGENTBUZZER_WEBHOOK_FIELD_MAPPING: '{"status":"state"}' }).fieldMapping, { status: "state" });
});

test("provider POST sends mapped JSON, optional authorization, and no credentials in payload", async () => {
  let request;
  await sendChannel("webhook", { url, accessToken: "secret", fieldMapping: { resultDetails: "body.text" } }, event, "Office", async (_url, options) => { request = options; return { ok: true }; }, context);
  const payload = JSON.parse(request.body);
  assert.equal(request.headers.Authorization, "Bearer secret");
  assert.equal(payload.body.text, event.resultDetails);
  assert.equal(payload.eventId, "id1");
  assert.ok(!request.body.includes("secret"));
});

test("DND, restart and retries preserve event identity, device and completion time", async (t) => {
  const env = workspace(t);
  let clock = Date.parse(context.createdAt);
  saveSettings({ deviceName: "Original", notifications: { dnd: true }, channels: { feishu: { enabled: false }, webhook: { enabled: true, url, payloadFormat: "standard" } } }, env);
  let service = createService({ env, now: () => new Date(clock), intervalMs: 100000 });
  await service.start(0);
  const accepted = await service.accept(event);
  const pending = listEntries(env)[0];
  assert.equal(pending.event.occurredAt, occurredAt);
  assert.equal(pending.deviceName, "Original");
  service.updateSettings({ deviceName: "Renamed" });
  await service.close();
  clock += 3600000;
  const attempts = [];
  service = createService({ env, now: () => new Date(clock), intervalMs: 100000, deliver: async (_name, config, delivered, device, _fetch, ctx) => {
    attempts.push(webhookPayload(config, delivered, device, ctx));
    if (attempts.length === 1) throw new Error("offline");
  } });
  t.after(() => service.close());
  await service.start(0);
  service.updateSettings({ notifications: { dnd: false } });
  for (let i = 0; i < 100 && !listEntries(env)[0]?.attempts; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attempts.length, 1);
  clock += 5000;
  await service.pump();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(attempts[0].eventId, accepted.id);
  assert.equal(attempts[0].deviceName, "Original");
  assert.equal(attempts[0].completedAt, occurredAt);
  assert.equal(listEntries(env).length, 0);
});

test("preview endpoint uses the same mapping with no delivery and rejects invalid mappings", async (t) => {
  const env = workspace(t);
  let deliveries = 0;
  const service = createService({ env, detectAdapters: async () => ({}), deliver: async () => deliveries++ });
  const address = await service.start(0);
  t.after(() => service.close());
  const post = (value) => fetch(`http://127.0.0.1:${address}/api/webhook/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const response = await post({ fieldMapping: { resultDetails: "data.message" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.message, "任务已完成");
  assert.equal((await post({ fieldMapping: { resultDetails: "status" } })).status, 400);
  assert.equal(deliveries, 0);
  assert.equal(listEntries(env).length, 0);
});
