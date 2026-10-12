import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { CHANNEL_CATALOG, channelEnv, validateEndpoint, validateField } from "../src/channel-schema.mjs";
import { loadChannelConfig, loadConfig, safeChannelSettings, saveSettings } from "../src/config.mjs";
import { credentialKeys, loadCredential, saveCredentials } from "../src/secret-store.mjs";
import { sendChannel } from "../src/channels.mjs";
import { hermesText, sendEmail, sendViaHermes } from "../src/channel-providers.mjs";
import { createService } from "../src/service.mjs";
import { listEntries } from "../src/queue.mjs";

const event = { agent: "Codex", status: "completed", summary: "Hello @everyone <!channel> & done" };
const token = "dummy-private-token-123456789012345";
const telegram = { botToken: `123456:${"a".repeat(32)}`, chatId: "-1234", threadId: 12 };
const cases = [
  ["webhook", { url: "https://example.com/secret-path", accessToken: token }, {}],
  ["slack", { url: "https://hooks.slack.com/services/T/B/secret" }, {}],
  ["telegram", telegram, { ok: true, result: { message_id: 1 } }],
  ["discord", { url: "https://discord.com/api/webhooks/123/secret" }, { id: "1" }],
  ["teams", { url: "https://prod-01.westus.logic.azure.com/workflows/example/triggers/manual/paths/invoke?sig=secret" }, {}],
  ["googlechat", { url: "https://chat.googleapis.com/v1/spaces/example/messages?key=secret&token=secret" }, { name: "spaces/example/messages/test" }],
  ["mattermost", { url: "https://mattermost.example.com/hooks/secret" }, {}],
  ["feishuBot", { url: "https://open.feishu.cn/open-apis/bot/v2/hook/secret", signingSecret: token }, { code: 0 }],
  ["dingtalk", { url: "https://oapi.dingtalk.com/robot/send?access_token=secret", signingSecret: token }, { errcode: 0 }],
  ["wecom", { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret" }, { errcode: 0 }],
  ["matrix", { serverUrl: "https://matrix.example.com", roomId: "!room:matrix.example.com", accessToken: token }, { event_id: "$event" }],
  ["ntfy", { serverUrl: "https://ntfy.sh", topic: "private-topic", accessToken: token }, { id: "1" }],
  ["bark", { serverUrl: "https://api.day.app", deviceKey: token }, { code: 200 }],
  ["gotify", { serverUrl: "http://127.0.0.1:8080", appToken: token, priority: 0 }, { id: 1 }],
  ["pushover", { appToken: token, userKey: token, device: "phone" }, { status: 1 }],
  ["line", { accessToken: token, recipientId: `U${"a".repeat(32)}` }, {}],
  ["sms", { accountSid: `AC${"a".repeat(32)}`, authToken: token, from: "+12025550101", to: "+12025550102" }, { sid: "SM1", error_code: null }],
];

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-channels-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-channels-"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, env: { AGENTBUZZER_CONFIG: join(dir, "config.json") } };
}

async function eventually(check) {
  for (let index = 0; index < 100; index++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 15)); }
  assert.fail("Timed out waiting for channel delivery");
}

test("catalog has 20 unique channels; new channels are opt-in", () => {
  assert.equal(CHANNEL_CATALOG.length, 20);
  assert.equal(new Set(CHANNEL_CATALOG.map(({ id }) => id)).size, 20);
  assert.deepEqual(CHANNEL_CATALOG.filter(({ defaultEnabled }) => defaultEnabled).map(({ id }) => id), ["feishu"]);
  assert.equal(channelEnv("feishuBot", { name: "signingSecret" }), "AGENTBUZZER_FEISHU_BOT_SIGNING_SECRET");
});

for (const [name, config, result] of cases) {
  test(`${name}: outbound request format and provider acknowledgement`, async () => {
    const requests = [];
    const fakeFetch = async (url, options) => {
      requests.push({ url, ...options });
      if (name === "matrix" && options.method === "GET") return { ok: false, status: 404, json: async () => ({ errcode: "M_NOT_FOUND" }) };
      return { ok: true, status: 200, headers: new Headers(), json: async () => result, text: async () => "ok" };
    };
    await sendChannel(name, config, event, "Test-PC", fakeFetch, { deliveryId: "queue-id" });
    const request = requests.at(-1);
    const body = request.headers["Content-Type"].startsWith("application/x-www") ? Object.fromEntries(new URLSearchParams(request.body)) : JSON.parse(request.body);
    assert.equal(request.redirect, "error");
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.method, name === "matrix" ? "PUT" : "POST");
    if (name === "webhook") { assert.equal(body.agentName, "Codex"); assert.equal(body.deviceName, "Test-PC"); assert.equal(body.appName, "AgentBuzzer"); assert.equal(body.eventId, "queue-id"); assert.equal(body.schemaVersion, 1); assert.equal(request.headers.Authorization, `Bearer ${token}`); }
    if (name === "slack") assert.match(body.text, /&lt;!channel&gt; &amp; done/);
    if (name === "telegram") { assert.equal(body.chat_id, telegram.chatId); assert.equal(body.message_thread_id, 12); assert.ok(!body.parse_mode); }
    if (name === "discord") { assert.deepEqual(body.allowed_mentions, { parse: [] }); assert.equal(new URL(request.url).searchParams.get("wait"), "true"); }
    if (name === "teams") assert.equal(body.attachments[0].content.type, "AdaptiveCard");
    if (["googlechat", "mattermost"].includes(name)) assert.doesNotMatch(body.text, /@everyone/);
    if (name === "feishuBot") { assert.equal(body.msg_type, "interactive"); assert.equal(body.card.schema, "2.0"); assert.equal(body.sign, createHmac("sha256", `${body.timestamp}\n${token}`).update("").digest("base64")); }
    if (name === "dingtalk") {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("sign"), createHmac("sha256", token).update(`${url.searchParams.get("timestamp")}\n${token}`).digest("base64"));
      assert.equal(body.at.isAtAll, false);
    }
    if (name === "wecom") assert.equal(body.msgtype, "text");
    if (name === "matrix") { assert.equal(requests.length, 2); assert.equal(body.msgtype, "m.text"); assert.deepEqual(body["m.mentions"], {}); }
    if (name === "ntfy") { assert.equal(body.topic, "private-topic"); assert.equal(request.headers.Authorization, `Bearer ${token}`); }
    if (name === "bark") assert.equal(body.device_key, token);
    if (name === "gotify") { assert.equal(body.priority, 0); assert.equal(request.headers["X-Gotify-Key"], token); }
    if (name === "pushover") assert.equal(body.token, token);
    if (name === "line") { assert.equal(body.to, config.recipientId); assert.deepEqual(body.messages.map(({ type }) => type), ["text"]); assert.match(request.headers["X-Line-Retry-Key"], /^[0-9a-f-]{36}$/); }
    if (name === "sms") { assert.equal(body.To, config.to); assert.equal(Buffer.from(request.headers.Authorization.slice(6), "base64").toString(), `${config.accountSid}:${token}`); }
    if (name !== "webhook") assert.match(JSON.stringify(body), /AgentBuzzer/);
  });
}

test("provider business errors and network failures do not disclose credentials", async () => {
  for (const [name, config] of cases.filter(([name]) => !["webhook", "teams", "mattermost", "line", "matrix"].includes(name))) {
    await assert.rejects(sendChannel(name, config, event, "PC", async () => ({ ok: true, status: 200, json: async () => ({ error: token, code: 1, errcode: 1, status: 0 }), text: async () => token })), (error) => !error.message.includes(token));
  }
  await assert.rejects(sendChannel("webhook", cases[0][1], event, "PC", async () => { throw new Error(token); }), (error) => !error.message.includes(token));
});

test("Matrix encryption and access failures never send a plaintext message", async () => {
  const config = cases.find(([name]) => name === "matrix")[1];
  for (const response of [{ ok: true, status: 200 }, { ok: false, status: 403, json: async () => ({ errcode: "M_FORBIDDEN" }) }]) {
    let calls = 0;
    await assert.rejects(sendChannel("matrix", config, event, "PC", async () => { calls++; return response; }));
    assert.equal(calls, 1);
  }
});

test("rate-limit retry and LINE/Matrix transaction keys survive retransmission", async () => {
  await assert.rejects(sendChannel("telegram", telegram, event, "PC", async () => ({ ok: false, status: 429, headers: new Headers({ "retry-after": "60" }) })), (error) => error.retryAfterMs === 60000 && !error.message.includes(telegram.botToken));
  await assert.rejects(sendChannel("telegram", telegram, event, "PC", async () => ({ ok: false, status: 429, headers: new Headers(), json: async () => ({ ok: false, parameters: { retry_after: 45 } }) })), (error) => error.retryAfterMs === 45000);
  const config = cases.find(([name]) => name === "line")[1];
  const keys = [];
  for (let attempt = 0; attempt < 2; attempt++) await sendChannel("line", config, event, "PC", async (_url, options) => {
    keys.push(options.headers["X-Line-Retry-Key"]);
    return { ok: false, status: 409, headers: new Headers({ "x-line-accepted-request-id": "accepted" }) };
  }, { deliveryId: "same-queue-id" });
  assert.equal(keys[0], keys[1]);
});

test("webhook validation restricts provider hosts, HTTPS and query credentials", () => {
  assert.throws(() => validateEndpoint("https://example.com/api/webhooks/123/token", "discord"));
  assert.throws(() => validateEndpoint("https://outlook.office.com/webhook/retired", "teams"));
  assert.throws(() => validateEndpoint("http://192.168.1.1", "ntfy", { server: true }));
  assert.throws(() => validateEndpoint("https://user:pass@example.com", "webhook"));
  assert.throws(() => validateEndpoint("https://example.com?token=secret", "gotify", { server: true }));
  assert.equal(validateEndpoint("http://127.0.0.1:8080", "gotify", { server: true }), "http://127.0.0.1:8080/");
});

test("SMTP requires TLS and uses a text-only, bounded transport", async () => {
  let options, message, closed = false;
  const create = (input) => { options = input; return { sendMail: async (value) => { message = value; return { accepted: ["to@example.com"], rejected: [] }; }, close: () => { closed = true; } }; };
  await sendEmail({ host: "smtp.example.com", port: 587, tls: "starttls", user: "user", password: token, from: "from@example.com", to: "to@example.com" }, event, "PC", create);
  assert.equal(options.secure, false); assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true);
  assert.ok(options.socketTimeout <= 10000); assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  assert.match(message.text, /AgentBuzzer/); assert.ok(!message.html); assert.equal(closed, true);
  await assert.rejects(sendEmail({ host: "smtp.example.com", port: 465, tls: "tls" }, event, "PC", () => ({ sendMail: async () => { throw new Error(token); } })), (error) => !error.message.includes(token));
});

test("Hermes bridge sends text via stdin without a shell or media directives", async () => {
  let launch, input;
  const fakeSpawn = (program, args, options) => {
    launch = { program, args, options };
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = (value) => { input = value; setImmediate(() => child.emit("close", 0)); };
    return child;
  };
  await sendViaHermes({ program: "hermes", target: "signal:+12025550102" }, "MEDIA:/private/file\n[[as_document]] text", { spawnImpl: fakeSpawn });
  assert.equal(launch.options.shell, false);
  assert.deepEqual(launch.args, ["send", "--to", "signal:+12025550102", "--file", "-", "--quiet"]);
  assert.ok(!launch.args.some((value) => value.includes("/private/file")));
  assert.doesNotMatch(input, /MEDIA:|\[\[as_document\]\]/);
  assert.equal(hermesText("normal message"), "normal message");
  const program = CHANNEL_CATALOG.find(({ id }) => id === "hermes").fields.find(({ name }) => name === "program");
  assert.throws(() => validateField("hermes", program, "cmd.exe"));
  assert.throws(() => validateField("hermes", program, "bash"));
});

test("credential storage roundtrips Unicode; metadata and config reads do not decrypt", (t) => {
  const { dir, env } = workspace(t);
  saveCredentials({ "telegram.botToken": telegram.botToken, "email.password": "\u5bc6\u7801-cafe-\ud83d\ude80" }, env);
  assert.equal(loadCredential("email.password", env), "\u5bc6\u7801-cafe-\ud83d\ude80");
  assert.ok(credentialKeys(env).has("telegram.botToken"));
  if (process.platform === "win32") assert.doesNotMatch(readFileSync(join(dir, "credentials.json"), "utf8"), new RegExp(telegram.botToken));
  else assert.equal(statSync(join(dir, "credentials.json")).mode & 0o777, 0o600);
  saveSettings({ channels: { feishu: { enabled: false }, telegram: { enabled: true, chatId: "123" } } }, env);
  assert.equal(loadConfig(env, { includeSecret: false }).channels.telegram.botToken, undefined);
  assert.equal(safeChannelSettings(env).telegram.botTokenConfigured, true);
  assert.equal(loadChannelConfig("telegram", env).botToken, telegram.botToken);
  saveCredentials({ "telegram.botToken": null }, env);
  assert.equal(loadCredential("telegram.botToken", env), undefined);
  assert.throws(() => saveCredentials({ "../outside": "secret" }, env));
  const restore = saveCredentials({ "email.password": "changed" }, env);
  assert.equal(loadCredential("email.password", env), "changed");
  restore();
  assert.equal(loadCredential("email.password", env), "\u5bc6\u7801-cafe-\ud83d\ude80");
});

test("legacy top-level Feishu settings survive edits to individual channels", (t) => {
  const { env } = workspace(t);
  env.AGENTBUZZER_FEISHU_APP_SECRET = "fake-secret";
  saveSettings({ feishu: { appId: "legacy-app", receiveId: "legacy-chat", receiveIdType: "chat_id" }, channels: { webhook: { enabled: false } } }, env);
  const service = createService({ env, detectAdapters: async () => ({}) });
  service.updateSettings({ channels: { feishu: { enabled: false } } });
  assert.equal(loadChannelConfig("feishu", env).appId, "legacy-app");
  service.updateSettings({ channels: { feishu: { enabled: true } } });
  assert.equal(loadChannelConfig("feishu", env).receiveId, "legacy-chat");
});

test("settings and scoped channel tests preserve privacy, DND and immediate discard", async (t) => {
  const { env, dir } = workspace(t);
  saveSettings({ notifications: { dnd: true }, channels: { feishu: { enabled: false } } }, env);
  const sent = [];
  const service = createService({ env, intervalMs: 100000, detectAdapters: async () => ({}), deliver: async (name, config) => sent.push({ name, config }) });
  await service.start(0); t.after(() => service.close());
  service.updateSettings({ channels: { telegram: { enabled: true, ...telegram }, discord: { enabled: true, url: cases[3][1].url } } });
  const state = await service.snapshot();
  assert.equal(state.channelCatalog.length, 20);
  assert.equal(state.settings.channels.telegram.configured, true);
  assert.doesNotMatch(JSON.stringify(state), /123456:|\/api\/webhooks\/123\/secret/);
  assert.doesNotMatch(readFileSync(env.AGENTBUZZER_CONFIG, "utf8"), /123456:|\/api\/webhooks\/123\/secret/);
  assert.equal((await service.testChannel("telegram")).disposition, "queued");
  assert.deepEqual(listEntries(env)[0].pendingChannels, ["telegram"]);
  assert.equal(sent.length, 0);
  service.updateSettings({ notifications: { dnd: false } });
  await eventually(() => !listEntries(env).length);
  assert.equal(sent[0].name, "telegram"); assert.equal(sent[0].config.botToken, telegram.botToken);
  service.updateSettings({ notifications: { enabled: false } });
  assert.equal((await service.testChannel("discord")).disposition, "dropped");
  assert.equal(listEntries(env).length, 0);
  service.updateSettings({ channels: { discord: { enabled: false, url: null } } });
  assert.equal(safeChannelSettings(env).discord.urlConfigured, false);
  assert.equal(loadChannelConfig("discord", env).url, undefined);
  assert.ok(readFileSync(join(dir, "credentials.json"), "utf8").length);
});

test("independent retry schedules persist provider Retry-After without delaying another channel", async (t) => {
  const { env } = workspace(t);
  let clock = Date.now(), failSecond = true;
  const calls = [];
  saveSettings({ notifications: { enabled: true }, channels: { feishu: { enabled: false }, telegram: { enabled: true, ...telegram }, discord: { enabled: true, url: cases[3][1].url } } }, env);
  const service = createService({ env, intervalMs: 100000, now: () => new Date(clock), deliver: async (name) => {
    calls.push(name);
    if (name === "telegram") { const error = new Error("rate limited"); error.retryAfterMs = 60000; throw error; }
    if (failSecond) throw new Error("offline");
  } });
  await service.start(0); t.after(() => service.close());
  await service.accept(event);
  await eventually(() => listEntries(env)[0]?.attempts === 2);
  const pending = listEntries(env)[0];
  assert.equal(pending.channelRetries.telegram.nextAttemptAt, clock + 60000);
  failSecond = false; clock += 3000;
  await service.pump();
  assert.deepEqual(calls, ["telegram", "discord", "discord"]);
  assert.deepEqual(listEntries(env)[0].pendingChannels, ["telegram"]);
  assert.equal(listEntries(env)[0].nextAttemptAt, clock - 3000 + 60000);
});

test("off during delivery cannot resurrect discarded queues or start later channels", async (t) => {
  const { env } = workspace(t);
  saveSettings({ channels: { feishu: { enabled: false }, telegram: { enabled: true, ...telegram }, discord: { enabled: true, url: cases[3][1].url } } }, env);
  let release, started = false;
  const pending = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const service = createService({ env, intervalMs: 100000, deliver: async (name) => { calls.push(name); started = true; await pending; } });
  await service.start(0); t.after(() => service.close());
  await service.accept(event);
  await eventually(() => started);
  service.updateSettings({ notifications: { enabled: false } });
  service.updateSettings({ notifications: { enabled: true } });
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(listEntries(env).length, 0);
  assert.deepEqual(calls, ["telegram"]);
});
