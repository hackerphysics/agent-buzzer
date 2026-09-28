import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { packagePlugins } from "../scripts/package-plugins.mjs";

test("native plugin bundles contain self-sufficient service and local hook paths", async () => {
  const paths = packagePlugins();
  for (const path of Object.values(paths)) {
    assert.ok(existsSync(join(path, "bin", "agent-buzzer.mjs")));
    assert.ok(existsSync(join(path, "src", "feishu.mjs")));
    assert.ok(existsSync(join(path, "scripts", "install.mjs")));
    assert.ok(existsSync(join(path, "package.json")));
    assert.ok(existsSync(join(path, ".github", "plugin", "marketplace.json")));
    await import(pathToFileURL(join(path, "src", "service.mjs")));
  }
  const codex = JSON.parse(readFileSync(join(paths.codex, "hooks", "hooks.json"), "utf8"));
  for (const groups of Object.values(codex.hooks)) {
    for (const group of groups) {
      assert.ok(group.hooks[0].commandWindows.startsWith(`"${process.execPath}" `));
      assert.doesNotMatch(group.hooks[0].commandWindows, /PLUGIN_ROOT|async/);
    }
  }
  const copilot = JSON.parse(readFileSync(join(paths.copilot, "hooks", "hooks.json"), "utf8"));
  assert.ok(existsSync(copilot.hooks.agentStop[0].args[0]));
  assert.equal(copilot.hooks.agentStop[0].exec, process.execPath);
  assert.ok(existsSync(join(paths.hermes, "__init__.py")));
  assert.match(readFileSync(join(paths.hermes, "__init__.py"), "utf8"), /NODE_BINARY = /);
});
