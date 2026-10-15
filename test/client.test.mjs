import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveSettings } from "../src/config.mjs";
import { listEntries } from "../src/queue.mjs";
import { ROOT, posixHookCommand, windowsHookCommand } from "../scripts/package-plugins.mjs";

async function fixture(t, handler, settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-client-"));
  const env = { ...process.env, AGENTBUZZER_CONFIG: join(dir, "config.json") };
  saveSettings({
    deviceName: "Hook test device",
    notifications: { dnd: true },
    channels: { feishu: { enabled: false }, webhook: { enabled: true } },
    ...settings,
  }, env);
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  env.AGENTBUZZER_PORT = String(server.address().port);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  return { env, dir };
}

async function runHook(env, action = "codex-stop", shell = false, { entry = join(ROOT, "bin", "agent-buzzer.mjs"), node = process.execPath } = {}) {
  const windows = process.platform === "win32";
  const command = (windows ? windowsHookCommand : posixHookCommand)(node, entry, action);
  const child = shell
    ? spawn(windows ? "powershell.exe" : "/bin/sh", windows
      ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command], { env, windowsHide: true })
    : spawn(node, [entry, action], { env, windowsHide: true });
  const started = Date.now();
  let stdout = "", stderr = "", timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
  }, 12000);
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify({
    turn_id: "isolated-hook-test", session_name: "Test task", model: "test-model",
    last_assistant_message: "Private test result",
    tool_input: { description: "Private approval description" },
  }));
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(timedOut, false, "Hook process must close well before the 15s Codex deadline");
    assert.equal(code, 0, stderr);
    assert.equal(stdout.trim(), "{}");
    assert.equal(stderr, "");
    return Date.now() - started;
  } finally { clearTimeout(timer); }
}

function health(response) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ service: "agent-buzzer" }));
}

test("unresponsive service health cannot exhaust the Codex hook deadline", async (t) => {
  const { env, dir } = await fixture(t, (request) => { request.resume(); });
  const elapsed = await runHook(env, "codex-stop", true);
  assert.ok(elapsed < 12000, `Full launcher took ${elapsed}ms`);
  const entries = listEntries(env);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].deviceName, "Hook test device");
  assert.equal(entries[0].event.model, "test-model");
  assert.equal(entries[0].event.sessionName, "Test task");
  assert.deepEqual(entries[0].pendingChannels, ["webhook"]);
  const records = readFileSync(join(dir, "codex-hook.log"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(records.map((entry) => entry.status), ["started", "completed", "exited"]);
  assert.equal(records.at(-1).exitCode, 0);
  assert.ok(records.at(-1).elapsedMs < 7000);
  assert.doesNotMatch(JSON.stringify(records), /Private test|isolated-hook-test/);
});

test("accepted events let the actual hook process and pipes close promptly", async (t) => {
  let events = 0;
  const { env } = await fixture(t, (request, response) => {
    request.resume();
    if (request.url === "/health") return health(response);
    events++;
    response.end(JSON.stringify({ disposition: "queued", id: "test-id" }));
  });
  assert.ok(await runHook(env) < 8000);
  assert.equal(events, 1);
  assert.deepEqual(listEntries(env), []);
});

test("cold-started background service cannot retain the hook's output pipes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-cold-"));
  const staged = join(dir, "staged");
  const app = join(dir, "User's app $HOME 100% & (test) ! cafe \u4e2d\u6587");
  const env = { ...process.env, AGENTBUZZER_CONFIG: join(dir, "config.json") };
  const allocator = createServer();
  await new Promise((resolve) => allocator.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${allocator.address().port}`;
  env.AGENTBUZZER_PORT = String(allocator.address().port);
  await new Promise((resolve) => allocator.close(resolve));
  t.after(async () => {
    try { await fetch(`${endpoint}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) }); } catch { /* Startup may have failed. */ }
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(200) }); }
      catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  saveSettings({ notifications: { dnd: true }, channels: { feishu: { enabled: false }, webhook: { enabled: true } } }, env);
  mkdirSync(join(staged, "runtime"), { recursive: true });
  for (const name of ["bin", "src", "package.json", "node_modules/nodemailer"]) {
    cpSync(join(ROOT, name), join(staged, name), { recursive: true });
  }
  renameSync(staged, app);
  const node = join(app, "runtime", process.platform === "win32" ? "node.exe" : "node");
  copyFileSync(process.execPath, node);
  assert.equal(readFileSync(join(app, "bin", "agent-buzzer.mjs"), "utf8"), readFileSync(join(ROOT, "bin", "agent-buzzer.mjs"), "utf8"));
  await runHook(env, "codex-stop", true, { entry: join(app, "bin", "agent-buzzer.mjs"), node });
  // The daemon must still be running when all hook output pipes have closed.
  assert.equal((await (await fetch(`${endpoint}/health`)).json()).service, "agent-buzzer");
  assert.equal(listEntries(env).length, 1);
  assert.equal(listEntries(env)[0].attempts, 0, "DND must prevent any remote delivery");
});

for (const failure of ["invalid JSON", "stalled body"]) {
  test(`event response ${failure} is persisted instead of failing the hook`, async (t) => {
    const { env } = await fixture(t, (request, response) => {
      request.resume();
      if (request.url === "/health") return health(response);
      response.writeHead(200, { "Content-Type": "application/json" });
      if (failure === "invalid JSON") response.end("not JSON");
      else response.write("{");
    });
    assert.ok(await runHook(env, "codex-permission") < 8000);
    assert.equal(listEntries(env).length, 1);
    assert.equal(listEntries(env)[0].event.status, "needs_input");
  });
}

for (const notifications of [{ enabled: false }, { agents: { Codex: false } }]) {
  test(`disabled ${notifications.enabled === false ? "notifications" : "agent"} does not contact the service or persist`, async (t) => {
    let requests = 0;
    const { env } = await fixture(t, (request, response) => {
      requests++;
      request.resume();
      response.end();
    }, { notifications });
    await runHook(env);
    assert.equal(requests, 0);
    assert.deepEqual(listEntries(env), []);
  });
}

test("disabling notifications during an offline wait still discards the event", async (t) => {
  let disabled = false;
  let env;
  ({ env } = await fixture(t, (request) => {
    request.resume();
    if (!disabled) {
      saveSettings({ notifications: { enabled: false } }, env);
      disabled = true;
    }
  }));
  await runHook(env);
  assert.equal(disabled, true);
  assert.deepEqual(listEntries(env), []);
});
