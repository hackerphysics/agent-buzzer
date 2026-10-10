import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createService } from "../src/service.mjs";
import { runCommand } from "../src/commands.mjs";

test("settings respond while adapter detection is pending; concurrent requests share one check", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-loading-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let finish;
  let checks = 0;
  const detection = new Promise((resolve) => { finish = resolve; });
  const service = createService({
    env: { AGENTBUZZER_CONFIG: join(dir, "config.json") }, intervalMs: 100000,
    detectAdapters: () => { checks++; return detection; },
  });
  t.after(async () => { finish({}); await service.close(); });
  const port = await service.start(0);
  const endpoint = `http://127.0.0.1:${port}/api/state`;
  const first = await (await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).json();
  const second = await (await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).json();
  assert.equal(first.settings.notifications.enabled, true);
  assert.equal(first.adapters, null);
  assert.equal(first.adaptersChecking, true);
  assert.equal(second.adaptersChecking, true);
  assert.equal(checks, 1);
  const result = { codex: { installed: true, available: true } };
  finish(result);
  await new Promise((resolve) => setImmediate(resolve));
  const ready = await (await fetch(endpoint)).json();
  assert.deepEqual(ready.adapters, result);
  assert.equal(ready.adaptersChecking, false);
  assert.equal(checks, 1);
});

test("adapter detection failure does not prevent settings from loading", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-loading-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const service = createService({
    env: { AGENTBUZZER_CONFIG: join(dir, "config.json") }, intervalMs: 100000,
    detectAdapters: async () => { throw new Error("private path or CLI output"); },
  });
  t.after(async () => service.close());
  await service.start(0);
  await service.snapshot();
  await new Promise((resolve) => setImmediate(resolve));
  const state = await service.snapshot();
  assert.equal(state.adaptersChecking, false);
  assert.equal(state.adaptersError, "Adapter detection failed");
  assert.equal(state.settings.notifications.enabled, true);
});

test("command timeout rejects even when a descendant holds output pipes open", async () => {
  const script = "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {stdio: ['ignore', process.stdout, process.stderr]}); setTimeout(() => {}, 30000)";
  const started = Date.now();
  await assert.rejects(runCommand(process.execPath, ["-e", script], { timeoutMs: 300 }), /timed out/);
  assert.ok(Date.now() - started < 2000);
});

test("command errors and successful output settle normally", async () => {
  assert.equal((await runCommand(process.execPath, ["-e", "console.log('ready')"])).trim(), "ready");
  await assert.rejects(runCommand(process.execPath, ["-e", "process.exit(1)"]), /code 1/);
  await assert.rejects(runCommand("agent-buzzer-missing-test-command", [], { timeoutMs: 1000 }));
});
