import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { packagePlugins, ROOT, windowsHookCommand } from "../scripts/package-plugins.mjs";

test("native plugin bundles contain self-sufficient service and local hook paths", async () => {
  const paths = packagePlugins();
  for (const path of Object.values(paths)) {
    assert.ok(existsSync(join(path, "bin", "agent-buzzer.mjs")));
    assert.ok(existsSync(join(path, "src", "feishu.mjs")));
    assert.ok(existsSync(join(path, "scripts", "install.mjs")));
    assert.ok(existsSync(join(path, "scripts", "uninstall.mjs")));
    assert.ok(existsSync(join(path, "package.json")));
    assert.ok(existsSync(join(path, ".github", "plugin", "marketplace.json")));
    await import(pathToFileURL(join(path, "src", "service.mjs")));
  }
  const codex = JSON.parse(readFileSync(join(paths.codex, "hooks", "hooks.json"), "utf8"));
  for (const groups of Object.values(codex.hooks)) {
    for (const group of groups) {
      assert.match(group.hooks[0].commandWindows, /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
      assert.doesNotMatch(group.hooks[0].commandWindows, /PLUGIN_ROOT|async/);
    }
  }
  const copilot = JSON.parse(readFileSync(join(paths.copilot, "hooks", "hooks.json"), "utf8"));
  assert.ok(existsSync(copilot.hooks.agentStop[0].args[0]));
  assert.equal(copilot.hooks.agentStop[0].exec, process.execPath);
  assert.ok(existsSync(join(paths.hermes, "__init__.py")));
  assert.match(readFileSync(join(paths.hermes, "__init__.py"), "utf8"), /NODE_BINARY = /);
});

test("Windows hook quotes paths independently of the outer shell", () => {
  const command = windowsHookCommand("C:\\User's tools\\node.exe", "C:\\app space\\entry.mjs", "codex-stop");
  const script = Buffer.from(command.split(" ").at(-1), "base64").toString("utf16le");
  assert.equal(script, "& 'C:\\User''s tools\\node.exe' 'C:\\app space\\entry.mjs' 'codex-stop'; exit $LASTEXITCODE");
});

test("Codex hooks execute in PowerShell and cmd.exe with notifications disabled", { skip: process.platform !== "win32" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ notifications: { enabled: false } }));
  const env = { ...process.env, AGENTBUZZER_CONFIG: config };
  const hooks = JSON.parse(readFileSync(join(packagePlugins().codex, "hooks", "hooks.json"), "utf8"));
  const legacy = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", hooks.hooks.Stop[0].hooks[0].command], {
    env, input: "{}", encoding: "utf8", windowsHide: true, timeout: 12000,
  });
  assert.equal(legacy.status, 1);
  for (const groups of Object.values(hooks.hooks)) {
    const command = groups[0].hooks[0].commandWindows;
    for (const [shell, args, raw] of [
      ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], false],
      [process.env.COMSPEC || "cmd.exe", ["/C", `"${command}"`], true],
    ]) {
      const result = spawnSync(shell, args, { env, input: '{"last_assistant_message":"private test content"}', encoding: "utf8", windowsVerbatimArguments: raw, windowsHide: true, timeout: 12000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "{}");
      assert.equal(result.stderr, "");
    }
  }
  assert.ok(!existsSync(join(dir, "queue")));
  const records = readFileSync(join(dir, "codex-hook.log"), "utf8");
  assert.doesNotMatch(records, /private test content/);
  assert.match(records, /"status":"completed"/);
  writeFileSync(config, "not-json");
  const failed = spawnSync(process.execPath, [join(ROOT, "bin", "agent-buzzer.mjs"), "codex-stop"], { env, input: "{}", encoding: "utf8", windowsHide: true });
  assert.equal(failed.status, 1);
  assert.match(readFileSync(join(dir, "codex-hook.log"), "utf8"), /"reason":"settings_error"/);
});

test("Windows launcher preserves stdin and exit status for paths containing spaces and apostrophes", { skip: process.platform !== "win32" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-quoted-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nested = join(dir, "User's app");
  mkdirSync(nested);
  const node = join(nested, "node.exe");
  const entry = join(nested, "entry.mjs");
  copyFileSync(process.execPath, node);
  writeFileSync(entry, "let input=''; for await (const chunk of process.stdin) input+=chunk; process.stdout.write(input); process.exitCode=7;");
  const command = windowsHookCommand(node, entry, "codex-stop");
  for (const [shell, args, raw] of [
    ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `${command}; exit $LASTEXITCODE`], false],
    [process.env.COMSPEC || "cmd.exe", ["/C", `"${command}"`], true],
  ]) {
    const result = spawnSync(shell, args, { input: "stdin-test", encoding: "utf8", windowsVerbatimArguments: raw, windowsHide: true, timeout: 12000 });
    assert.ifError(result.error);
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, "stdin-test");
  }
});
