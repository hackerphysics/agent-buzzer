import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, saveSettings } from "../src/config.mjs";
import { advanceCycle, deliveryDecision, ingressDecision, resetBreak, validateNotifications, withinWorkHours } from "../src/policy.mjs";
import { listEntries, makeEntry, persistEntry } from "../src/queue.mjs";
import { createService } from "../src/service.mjs";
import { sendChannel, validateEndpoint } from "../src/channels.mjs";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { AGENTBUZZER_CONFIG: join(dir, "config.json"), AGENTBUZZER_FEISHU_APP_SECRET: "test-secret" };
  return { dir, env };
}

async function eventually(check) {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for queue operation");
}

const event = (agent = "Codex") => ({ agent, status: "completed", summary: "Done" });

test("off discards, DND holds, and working-hours boundary drops incoming events", () => {
  const n = validateNotifications({ workHours: { enabled: true, days: [1], start: "09:00", end: "17:00" } });
  const monday = (hour) => new Date(2026, 8, 28, hour, 0, 0);
  assert.equal(withinWorkHours(n.workHours, monday(9)), true);
  assert.equal(withinWorkHours(n.workHours, monday(17)), false);
  assert.equal(ingressDecision(n, "Codex", monday(17)), "outside_hours");
  assert.equal(deliveryDecision(n, "Codex", "work", monday(17)), "wait");
  assert.equal(ingressDecision({ ...n, enabled: false }, "Codex", monday(9)), "disabled");
  assert.equal(deliveryDecision({ ...n, enabled: false }, "Codex", "work", monday(9)), "drop");
  assert.equal(ingressDecision({ ...n, agents: { ...n.agents, Codex: false } }, "Codex", monday(9)), "disabled");
  assert.equal(deliveryDecision({ ...n, dnd: true }, "Codex", "work", monday(9)), "wait");
  assert.equal(deliveryDecision(n, "Codex", "break", monday(9)), "send");
  assert.equal(deliveryDecision({ ...n, cycle: { ...n.cycle, enabled: true } }, "Codex", "break", monday(9)), "wait");
  const overnight = { ...n.workHours, days: [1], start: "22:00", end: "06:00" };
  assert.equal(withinWorkHours(overnight, new Date(2026, 8, 29, 2)), true);
  assert.equal(withinWorkHours(overnight, new Date(2026, 8, 29, 6)), false);
  assert.throws(() => validateNotifications({ workHours: { start: "25:00" } }));
});

test("service persists failed deliveries and replays after restart", async (t) => {
  const { env } = workspace(t);
  let time = new Date(2026, 8, 28, 10).getTime();
  let first = createService({ env, now: () => new Date(time), deliver: async () => { throw new Error("offline"); }, intervalMs: 100000 });
  await first.start(0);
  const result = await first.accept(event());
  assert.equal(result.disposition, "queued");
  await eventually(() => listEntries(env)[0]?.attempts === 1);
  assert.equal(listEntries(env).length, 1);
  await first.close();
  first = null;
  time += 5000;
  const sent = [];
  const second = createService({ env, now: () => new Date(time), deliver: async (channel, _config, delivered) => { sent.push({ channel, delivered }); }, intervalMs: 100000 });
  t.after(async () => second.close());
  await second.start(0);
  assert.equal(listEntries(env).length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "feishu");
  assert.equal(sent[0].delivered.summary, "Done");
});

test("turning notifications off purges backlog and never replays it when on again", async (t) => {
  const { env } = workspace(t);
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: { ...n, dnd: true } }, env);
  const sent = [];
  const service = createService({ env, deliver: async (...args) => sent.push(args), intervalMs: 100000 });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(event("Codex"));
  await service.accept(event("Hermes"));
  assert.equal(listEntries(env).length, 2);
  service.updateSettings({ notifications: { ...n, enabled: false } });
  assert.equal(listEntries(env).length, 0);
  assert.equal((await service.accept(event())).disposition, "dropped");
  service.updateSettings({ notifications: n });
  await service.pump();
  assert.equal(sent.length, 0);

  service.updateSettings({ notifications: { ...n, dnd: true } });
  await service.accept(event("Codex"));
  await service.accept(event("Hermes"));
  service.updateSettings({ notifications: { ...n, dnd: true, agents: { ...n.agents, Codex: false } } });
  assert.deepEqual(listEntries(env).map((entry) => entry.event.agent), ["Hermes"]);
});

test("DND backlog waits through off hours; new off-hours events are discarded", async (t) => {
  const { env } = workspace(t);
  let time = new Date(2026, 8, 28, 16).getTime();
  const n = loadConfig(env).notifications;
  const hours = { enabled: true, days: [1, 2], start: "09:00", end: "17:00" };
  saveSettings({ notifications: { ...n, dnd: true, workHours: hours } }, env);
  const sent = [];
  const service = createService({ env, now: () => new Date(time), deliver: async (channel) => sent.push(channel), intervalMs: 100000 });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(event());
  time = new Date(2026, 8, 28, 18).getTime();
  service.updateSettings({ notifications: { ...n, dnd: false, workHours: hours } });
  assert.equal((await service.accept(event())).reason, "outside_hours");
  await service.pump();
  assert.equal(sent.length, 0);
  assert.equal(listEntries(env).length, 1);
  time = new Date(2026, 8, 29, 9).getTime();
  await service.pump();
  assert.equal(sent.length, 1);
  assert.equal(listEntries(env).length, 0);
});

test("new events extend Break, replay does not reset its timer", async (t) => {
  const { env } = workspace(t);
  let time = new Date(2026, 8, 28, 10).getTime();
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: { ...n, cycle: { enabled: true, workMinutes: 1, breakMinutes: 1 } } }, env);
  const service = createService({ env, now: () => new Date(time), deliver: async () => {}, intervalMs: 100000 });
  t.after(async () => service.close());
  await service.start(0);
  time += 61000;
  await service.pump();
  const statePath = join(env.AGENTBUZZER_CONFIG, "..", "cycle.json");
  const before = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(before.phase, "break");
  time += 30000;
  await service.accept(event());
  const after = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(after.until, time + 60000);
  await service.pump();
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).until, after.until);
  assert.equal(resetBreak({ enabled: true, breakMinutes: 1 }, after, time).until, after.until);
  assert.equal(advanceCycle({ enabled: true, workMinutes: 1, breakMinutes: 1 }, after, time).phase, "break");
});

test("queue files remain independent when hooks arrive concurrently", (t) => {
  const { env } = workspace(t);
  for (let i = 0; i < 30; i++) persistEntry(makeEntry(event(), 1000), env);
  assert.equal(listEntries(env).length, 30);
});

test("each channel is retried independently without resending a successful channel", async (t) => {
  const { env } = workspace(t);
  let time = Date.now();
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: n, channels: {
    feishu: { enabled: true }, webhook: { enabled: true, url: "https://example.com/hook" }, slack: { enabled: false },
  } }, env);
  const attempts = [];
  const service = createService({ env, now: () => new Date(time), intervalMs: 100000, deliver: async (name) => {
    attempts.push(name);
    if (name === "webhook" && attempts.filter((item) => item === name).length === 1) throw new Error("offline");
  } });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(event());
  await eventually(() => listEntries(env)[0]?.attempts === 1);
  assert.deepEqual(listEntries(env)[0].pendingChannels, ["webhook"]);
  time += 3000;
  await service.pump();
  assert.deepEqual(attempts, ["feishu", "webhook", "webhook"]);
  assert.equal(listEntries(env).length, 0);
});

test("disabling one channel drops only its pending delivery", async (t) => {
  const { env } = workspace(t);
  const n = loadConfig(env).notifications;
  const channels = { feishu: { enabled: true }, webhook: { enabled: true, url: "https://example.com/hook" }, slack: { enabled: false } };
  saveSettings({ notifications: { ...n, dnd: true }, channels }, env);
  const service = createService({ env, deliver: async () => assert.fail("DND must not deliver"), intervalMs: 100000 });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept(event());
  service.updateSettings({ channels: { webhook: { enabled: false } } });
  assert.deepEqual(listEntries(env)[0].pendingChannels, ["feishu"]);
  service.updateSettings({ channels: { feishu: { enabled: false } } });
  assert.equal(listEntries(env).length, 0);
});

test("webhook and Slack format payloads without disclosing endpoint URLs", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return { ok: true, status: 200 }; };
  await sendChannel("webhook", { url: "https://example.com/notify" }, event(), "PC", fetchImpl);
  assert.deepEqual(JSON.parse(requests[0].init.body), { event: event(), deviceName: "PC" });
  await sendChannel("slack", { url: "https://hooks.slack.com/services/T/B/key" }, { ...event(), summary: "<@all> & done" }, "PC", fetchImpl);
  assert.match(JSON.parse(requests[1].init.body).text, /&lt;@all&gt; &amp; done/);
  assert.throws(() => validateEndpoint("http://example.com", "webhook"), /HTTPS/);
  assert.throws(() => validateEndpoint("https://example.com/services/T/B/key", "slack"), /Slack/);
});

test("local API keeps URLs private and applies immediate discard through HTTP", async (t) => {
  const { env } = workspace(t);
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: { ...n, dnd: true }, channels: {
    feishu: { enabled: false }, webhook: { enabled: true, url: "https://example.com/secret-token" }, slack: { enabled: false },
  } }, env);
  const service = createService({ env, intervalMs: 100000, deliver: async () => assert.fail("DND must hold") });
  t.after(async () => service.close());
  const port = await service.start(0);
  const url = `http://127.0.0.1:${port}`;
  const denied = await fetch(`${url}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify(event()),
  });
  assert.equal(denied.status, 403);
  const accepted = await fetch(`${url}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event()),
  });
  assert.equal((await accepted.json()).disposition, "queued");
  const state = await (await fetch(`${url}/api/state`)).text();
  assert.doesNotMatch(state, /secret-token|test-secret/);
  const icon = await fetch(`${url}/icon.svg`);
  assert.match(icon.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await icon.text(), /AgentBuzzer/);
  const updated = await fetch(`${url}/api/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notifications: { ...n, enabled: false } }),
  });
  assert.equal((await updated.json()).discarded, 1);
  assert.equal(listEntries(env).length, 0);
});

test("service health reports version and supports graceful replacement", async (t) => {
  const { env } = workspace(t);
  const service = createService({ env, intervalMs: 100000 });
  const port = await service.start(0);
  const url = `http://127.0.0.1:${port}`;
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.service, "agent-buzzer");
  assert.equal(health.version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  const response = await fetch(`${url}/api/shutdown`, { method: "POST" });
  assert.equal((await response.json()).stopped, true);
  await eventually(async () => {
    try { await fetch(`${url}/health`); return false; }
    catch { return true; }
  });
});
