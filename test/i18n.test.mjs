import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import test from "node:test";
import { LANGUAGES, ENGLISH, normalizeLanguage, translate, translateError, eventSummary } from "../src/i18n.mjs";
import { CHANNEL_CATALOG } from "../src/channel-schema.mjs";
import { loadConfig, saveSettings, readSettings } from "../src/config.mjs";
import { createService } from "../src/service.mjs";
import { buildCard } from "../src/card.mjs";
import { notificationText, sendEmail } from "../src/channel-providers.mjs";
import { fromCodexStop, fromHermes } from "../src/adapters.mjs";
import { webhookPayload } from "../src/webhook.mjs";
import { makeEntry, persistEntry, listEntries } from "../src/queue.mjs";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-language-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-language-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { AGENTBUZZER_CONFIG: join(dir, "config.json") };
}

test("every app-owned UI and catalog label has a complete English translation", () => {
  const ui = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../src/ui.html", import.meta.url), "utf8");
  const labels = new Set([...ui.matchAll(/"([^"\r\n]*\p{Script=Han}[^"\r\n]*)"/gu)].map((match) => match[1]));
  for (const match of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) labels.add(match[1]);
  for (const definition of CHANNEL_CATALOG) {
    labels.add(definition.label); labels.add(definition.group);
    for (const spec of definition.fields) {
      labels.add(spec.label);
      for (const label of Object.values(spec.optionLabels || {})) labels.add(label);
      for (const field of spec.fields || []) labels.add(field.label);
    }
  }
  for (const label of labels) {
    if (/\p{Script=Han}/u.test(label)) assert.ok(Object.hasOwn(ENGLISH, label), `Missing English: ${label}`);
    assert.doesNotMatch(translate(label, "en"), /\p{Script=Han}/u, label);
  }
  assert.deepEqual(LANGUAGES, ["zh-CN", "en"]);
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(normalizeLanguage("fr"), "zh-CN");
  assert.equal(translate("{count} 个通道已开启", "en", { count: 1 }), "1 channel enabled");
  assert.equal(translate("{count} 个通道已开启", "en", { count: 2 }), "2 channels enabled");
  assert.equal(translate("{agent} 适配器已安装", "en", { agent: "Codex" }), "Codex adapter installed");
  assert.equal(translate("__proto__", "en"), "__proto__");
  assert.equal(translate("constructor", "en", { count: 1 }), "constructor");
});

test("settings API persists only the language preference and serves the localized module", async (t) => {
  const env = workspace(t);
  const original = { deviceName: "办公电脑", notifications: { enabled: false, dnd: true }, channels: { feishu: { enabled: false }, webhook: { enabled: false, fieldMapping: { deviceName: "machine" } } }, arbitrary: "keep" };
  saveSettings(original, env);
  assert.equal(loadConfig(env, { includeSecret: false }).language, "zh-CN");
  const service = createService({ env, detectAdapters: async () => ({}), deliver: async () => assert.fail("No real delivery") });
  const port = await service.start(0); t.after(() => service.close());
  const base = `http://127.0.0.1:${port}`;
  const put = (language) => fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }) });
  const response = await put("en");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.language, "en");
  assert.deepEqual(readSettings(env), { ...original, language: "en" });
  const html = await (await fetch(base)).text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /type="module"/);
  const module = await fetch(`${base}/i18n.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type"), /javascript/);
  assert.match(await module.text(), /export function translate/);
  assert.equal((await put("fr")).status, 400);
  assert.equal(loadConfig(env, { includeSecret: false }).language, "en");
  await put("zh-CN");
  assert.equal(loadConfig(env, { includeSecret: false }).language, "zh-CN");
  writeFileSync(env.AGENTBUZZER_CONFIG, "{broken");
  const fallback = await fetch(base);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /<html lang="zh-CN">/);
  saveSettings({ ...original, language: "zh-CN" }, env);
});

test("notifications translate app-owned copy but leave results, names, and JSON field names intact", async () => {
  const event = { agent: "Codex", status: "completed", summary: "用户原始回复", sessionName: "我的会话", occurredAt: "2026-10-12T08:00:00Z", url: "https://example.com/task" };
  const card = buildCard(event, "办公电脑", { language: "en" });
  assert.equal(card.header.title.content, "Codex · Task completed");
  assert.equal(card.header.subtitle.content, "我的会话");
  assert.equal(card.body.elements[0].content, "用户原始回复");
  assert.equal(card.body.elements[1].text.content, "View Task");
  assert.match(card.body.elements.at(-1).text.content, /Completed At:/);
  assert.doesNotMatch(card.body.elements.at(-1).text.content, /完成时间/);
  assert.match(notificationText(event, "办公电脑", "en"), /Completed\n用户原始回复/);
  const empty = fromCodexStop({});
  assert.equal(eventSummary(empty, "en"), "This task turn has ended");
  assert.equal(buildCard(empty, "PC", { language: "en" }).body.elements[0].content, "This task turn has ended");
  assert.equal(eventSummary({ summary: "本轮任务已结束" }, "en"), "本轮任务已结束");
  assert.equal(eventSummary(fromHermes({ status: "failed", summary: "本轮已中断", summaryKey: "本轮已中断" }), "en"), "This turn was interrupted");
  const body = webhookPayload({}, empty, "PC", { language: "en", deliveryId: "id" });
  assert.equal(body.resultDetails, "This task turn has ended");
  assert.equal(body.agentName, "Codex");
  assert.equal(body.schemaVersion, 1);
  assert.equal(webhookPayload({ payloadFormat: "legacy" }, empty, "PC", { language: "en" }).event.summary, "This task turn has ended");
  let message;
  await sendEmail({ host: "smtp.example.test", tls: "tls" }, empty, "PC", () => ({ sendMail: async (value) => { message = value; return { accepted: ["test@example.test"] }; } }), "en");
  assert.match(message.text, /Completed\nThis task turn has ended/);
});

test("DND replay uses the selected language without discarding pending events", async (t) => {
  const env = workspace(t);
  saveSettings({ language: "zh-CN", notifications: { dnd: true }, channels: { feishu: { enabled: false }, webhook: { enabled: true, url: "https://example.test/hook" } } }, env);
  const pending = makeEntry(fromCodexStop({}), Date.now(), ["webhook"]);
  persistEntry(pending, env);
  let delivered;
  const service = createService({ env, intervalMs: 100000, detectAdapters: async () => ({}), deliver: async (_channel, _config, event, _device, _fetch, context) => { delivered = { event, context }; } });
  await service.start(0); t.after(() => service.close());
  service.updateSettings({ language: "en" });
  assert.equal(listEntries(env).length, 1);
  assert.equal(listEntries(env)[0].id, pending.id);
  assert.equal((await service.snapshot()).queue[0].summaryKey, "本轮任务已结束");
  service.updateSettings({ notifications: { dnd: false } });
  for (let i = 0; i < 100 && !delivered; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(delivered.context.language, "en");
  assert.equal(eventSummary(delivered.event, delivered.context.language), "This task turn has ended");
});

test("validation and provider errors localize without modifying technical paths or field names", () => {
  assert.equal(translateError("Invalid device name", "zh-CN"), "设备名称无效");
  assert.equal(translateError("Invalid 优先级", "en"), "Invalid Priority");
  assert.equal(translateError("Configure 飞书应用: 接收者 ID", "en"), "Configure Feishu App: Recipient ID");
  assert.equal(translateError("飞书群机器人 request failed", "en"), "Feishu Group Bot request failed");
  assert.equal(translateError("飞书群机器人 HTTP 429", "en"), "Feishu Group Bot HTTP 429");
  assert.equal(translateError("Conflicting Webhook paths: data.message, data", "zh-CN"), "Webhook 目标路径冲突：data.message, data");
  assert.equal(translateError("Invalid Webhook path: deviceName", "zh-CN"), "Webhook 目标路径无效：deviceName");
});
