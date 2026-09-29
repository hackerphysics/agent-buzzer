import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { uninstallAdapter } from "../scripts/uninstall.mjs";
import { loadConfig, saveSettings } from "../src/config.mjs";
import { listEntries } from "../src/queue.mjs";
import { createService } from "../src/service.mjs";

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "agent-buzzer-uninstall-"));
  t.after(() => {
    if (root.startsWith(`${tmpdir()}${sep}agent-buzzer-uninstall-`)) rmSync(root, { recursive: true, force: true });
  });
  return { root, env: { AGENTBUZZER_CONFIG: join(root, "config.json"), AGENTBUZZER_FEISHU_APP_SECRET: "test" } };
}

test("Codex removal selects only AgentBuzzer and keeps marketplace registration", () => {
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (args[1] === "list") return JSON.stringify({ installed: [
      { pluginId: "other@agent-buzzer-local" },
      { pluginId: "agent-buzzer@agent-buzzer-local" },
    ] });
    return "";
  };
  assert.deepEqual(uninstallAdapter("codex", { run }), { removed: true });
  assert.deepEqual(calls.at(-1), ["codex", "plugin", "remove", "agent-buzzer@agent-buzzer-local"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(uninstallAdapter("codex", { run: () => JSON.stringify({ installed: [{ pluginId: "other@agent-buzzer-local" }] }) }), { removed: false });
});

test("Copilot removal targets the marketplace copy, not unrelated or direct plugins", () => {
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (args[1] === "list") return JSON.stringify([
      { name: "other", marketplace: "agent-buzzer-local", enabled: true },
      { name: "agent-buzzer", marketplace: "", enabled: true },
      { name: "agent-buzzer", marketplace: "agent-buzzer-local", enabled: true },
    ]);
    return "";
  };
  assert.deepEqual(uninstallAdapter("copilot", { run }), { removed: true });
  assert.deepEqual(calls.at(-1), ["copilot", "plugin", "uninstall", "agent-buzzer@agent-buzzer-local"]);
  assert.deepEqual(uninstallAdapter("copilot", { run: () => JSON.stringify([{ name: "agent-buzzer", marketplace: "", enabled: true }]) }), { removed: false });
});

test("Hermes checks the exact plugin manifest before native removal", (t) => {
  const { root } = workspace(t);
  const plugins = join(root, "plugins");
  const target = join(plugins, "agent-buzzer");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "plugin.yaml"), 'name: other-plugin\n');
  const calls = [];
  const run = (program, args) => { calls.push([program, ...args]); return ""; };
  assert.throws(() => uninstallAdapter("hermes", { run, env: { HERMES_HOME: root } }), /not AgentBuzzer/);
  assert.equal(calls.length, 0);
  writeFileSync(join(target, "plugin.yaml"), 'name: agent-buzzer\nversion: "0.2.2"\n');
  assert.deepEqual(uninstallAdapter("hermes", { run, env: { HERMES_HOME: root } }), { removed: true });
  assert.deepEqual(calls, [["hermes", "plugins", "remove", "agent-buzzer"]]);
  assert.match(readFileSync(join(target, "plugin.yaml"), "utf8"), /agent-buzzer/);
  assert.throws(() => uninstallAdapter("unknown", { run }), /Unsupported adapter/);
});

test("service removal discards only that Agent's backlog through the local API", async (t) => {
  const { env } = workspace(t);
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: { ...n, dnd: true } }, env);
  const calls = [];
  const service = createService({ env, intervalMs: 100000, deliver: async () => assert.fail("DND must hold"), uninstall: async (agent) => {
    calls.push(agent);
    return { removed: true };
  } });
  t.after(async () => service.close());
  const port = await service.start(0);
  await service.accept({ agent: "Codex", status: "completed", summary: "One" });
  await service.accept({ agent: "Hermes", status: "completed", summary: "Two" });
  const response = await fetch(`http://127.0.0.1:${port}/api/uninstall/codex`, { method: "POST" });
  assert.deepEqual(await response.json(), { removed: true, discarded: 1 });
  assert.deepEqual(calls, ["codex"]);
  assert.deepEqual(listEntries(env).map((entry) => entry.event.agent), ["Hermes"]);
});

test("failed removal leaves pending events intact", async (t) => {
  const { env } = workspace(t);
  const n = loadConfig(env).notifications;
  saveSettings({ notifications: { ...n, dnd: true } }, env);
  const service = createService({ env, intervalMs: 100000, uninstall: async () => { throw new Error("CLI failed"); } });
  t.after(async () => service.close());
  await service.start(0);
  await service.accept({ agent: "Codex", status: "completed", summary: "Keep me" });
  await assert.rejects(service.removeAdapter("codex"), /CLI failed/);
  assert.deepEqual(listEntries(env).map((entry) => entry.event.summary), ["Keep me"]);
});
