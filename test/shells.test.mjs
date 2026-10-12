import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { posixHookCommand, ROOT, windowsHookCommand } from "../scripts/package-plugins.mjs";

const windows = process.platform === "win32";
const strict = process.env.AGENTBUZZER_REQUIRE_SHELLS === "1";
const gitBash = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
  .filter(Boolean).map((root) => join(root, "Git", "bin", "bash.exe")).find(existsSync);
const shells = windows ? [
  { name: "cmd.exe", program: process.env.COMSPEC || "cmd.exe", args: (command) => ["/D", "/S", "/C", `"${command}"`], raw: true },
  { name: "Windows PowerShell 5.1", program: "powershell.exe", args: (command) => ["-NoProfile", "-NonInteractive", "-Command", command], nonzeroExit: 1 },
  { name: "PowerShell 7", program: "pwsh.exe", args: (command) => ["-NoProfile", "-NonInteractive", "-Command", command], nonzeroExit: 1 },
  { name: "Git Bash", program: gitBash || "agent-buzzer-missing-git-bash", args: (command) => ["--noprofile", "--norc", "-c", command] },
] : [
  { name: "sh", program: "/bin/sh", args: (command) => ["-c", command] },
  { name: "bash", program: "bash", args: (command) => ["--noprofile", "--norc", "-c", command] },
  ...(process.platform === "linux" ? [{ name: "dash", program: "dash", args: (command) => ["-c", command] }] : []),
  { name: "zsh", program: "zsh", args: (command) => ["-f", "-c", command] },
  { name: "fish", program: "fish", args: (command) => ["--no-config", "-c", command] },
];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-shell-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-shell-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const name = windows ? "User's app $HOME 100% & (test) ! cafe \u4e2d\u6587"
    : "User's app $HOME `echo BAD` $(echo BAD) ; & (test) ! \"quoted\" newline\n cafe \u4e2d\u6587";
  const folder = join(dir, name);
  mkdirSync(folder);
  // Node's ESM loader forbids backslashes in Unix module paths; the executable does not.
  const runtime = join(folder, windows ? "runtime" : "runtime \\\\ \\backslash");
  mkdirSync(runtime);
  const node = join(runtime, windows ? "node.exe" : "node");
  copyFileSync(process.execPath, node);
  if (!windows) chmodSync(node, 0o755);
  const entry = join(folder, "entry.mjs");
  writeFileSync(entry, "import {writeFileSync} from 'node:fs'; let input=''; for await (const chunk of process.stdin) input+=chunk; const result=JSON.stringify({input,args:process.argv.slice(2)}); if(process.env.TEST_CAPTURE_FILE) writeFileSync(process.env.TEST_CAPTURE_FILE,result); process.stdout.write(result); process.exitCode=Number(process.env.TEST_EXIT_CODE || 0);");
  const config = join(folder, "config.json");
  writeFileSync(config, JSON.stringify({ notifications: { enabled: false } }));
  return { node, entry, config, dir };
}

const input = JSON.stringify({ last_assistant_message: "\u4e2d\u6587 cafe \ud83d\ude80\nquotes: '$HOME' `x` \\ \"", turn_id: "shell-test" });

test("POSIX launcher contains no literal paths or shell-expanded path contents", () => {
  const command = posixHookCommand("/User's $HOME/\\\\node", "/\u4e2d\u6587/entry.mjs", "codex-stop");
  assert.match(command, /^\/bin\/sh -c 'exec /);
  assert.doesNotMatch(command, /User|HOME|entry\.mjs|\u4e2d\u6587/);
  assert.equal(command.replaceAll("'", "").length, command.length - 2);
});

for (const shell of shells) {
  test(`hook launch contracts: ${process.platform} / ${shell.name}`, (t) => {
    const probe = spawnSync(shell.program, shell.args("exit 0"), { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: shell.raw, timeout: 10000 });
    if (probe.error?.code === "ENOENT") {
      if (strict) assert.fail(`Required shell is missing: ${shell.name}`);
      t.skip(`Shell not installed: ${shell.name}`);
      return;
    }
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr);
    const files = fixture(t);
    const build = windows ? windowsHookCommand : posixHookCommand;
    for (const exitCode of [0, 7]) {
      const command = build(files.node, files.entry, "codex-stop");
      const result = spawnSync(shell.program, shell.args(command), {
        input, env: { ...process.env, TEST_EXIT_CODE: String(exitCode) }, encoding: "utf8",
        windowsHide: true, windowsVerbatimArguments: shell.raw, timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, exitCode ? shell.nonzeroExit || exitCode : 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { input, args: ["codex-stop"] });
      assert.equal(result.stderr, "");
    }
    for (const action of ["codex-stop", "codex-permission"]) {
      const command = build(files.node, join(ROOT, "bin", "agent-buzzer.mjs"), action);
      const result = spawnSync(shell.program, shell.args(command), {
        input, env: { ...process.env, AGENTBUZZER_CONFIG: files.config }, encoding: "utf8",
        windowsHide: true, windowsVerbatimArguments: shell.raw, timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "{}");
      assert.equal(result.stderr, "");
    }
    assert.ok(!existsSync(join(files.dir, "queue")));
    assert.ok(!existsSync(join(dirname(files.config), "queue")));
    const records = readFileSync(join(dirname(files.config), "codex-hook.log"), "utf8");
    assert.doesNotMatch(records, /shell-test|last_assistant_message/);
  });
}

test("Copilot uses executable and argument arrays without a shell", (t) => {
  const files = fixture(t);
  const hooks = JSON.parse(readFileSync(join(ROOT, "plugins", "copilot", "hooks", "hooks.json"), "utf8"));
  for (const entries of Object.values(hooks.hooks)) {
    for (const entry of entries) {
      const result = spawnSync(files.node, [files.entry, ...entry.args.slice(1)], { input, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { input, args: entry.args.slice(1) });
    }
  }
});

test("Hermes subprocess preserves paths and UTF-8 payloads without a shell", (t) => {
  const python = windows ? "python" : "python3";
  const probe = spawnSync(python, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (probe.error?.code === "ENOENT") {
    if (strict) assert.fail("Python is required to test the Hermes launch contract");
    t.skip("Python not installed");
    return;
  }
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);
  const files = fixture(t);
  const capture = join(files.dir, "hermes.json");
  const script = "import importlib.util,os,pathlib; spec=importlib.util.spec_from_file_location('buzzer',os.environ['TEST_HERMES_PLUGIN']); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); m.NODE_BINARY=os.environ['TEST_NODE']; m.ENTRY=pathlib.Path(os.environ['TEST_ENTRY']); m._send('completed',os.environ['TEST_SUMMARY'],'session','turn')";
  const result = spawnSync(python, ["-B", "-c", script], { encoding: "utf8", windowsHide: true, timeout: 15000, env: {
    ...process.env, TEST_HERMES_PLUGIN: join(ROOT, "plugins", "hermes", "__init__.py"),
    TEST_NODE: files.node, TEST_ENTRY: files.entry, TEST_SUMMARY: JSON.parse(input).last_assistant_message, TEST_CAPTURE_FILE: capture,
  } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const recorded = JSON.parse(readFileSync(capture, "utf8"));
  assert.deepEqual(recorded.args, ["hermes-event"]);
  assert.deepEqual(JSON.parse(recorded.input), { status: "completed", summary: JSON.parse(input).last_assistant_message, session_id: "session", turn_id: "turn" });
});
