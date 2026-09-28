import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { packagePlugins } from "../scripts/package-plugins.mjs";

test("native plugin bundles contain self-sufficient senders and local hook paths", () => {
  const paths = packagePlugins();
  for (const path of Object.values(paths)) {
    assert.ok(existsSync(join(path, "bin", "agent-buzzer.mjs")));
    assert.ok(existsSync(join(path, "src", "feishu.mjs")));
  }
  const codex = JSON.parse(readFileSync(join(paths.codex, "hooks", "hooks.json"), "utf8"));
  for (const groups of Object.values(codex.hooks)) {
    for (const group of groups) {
      assert.match(group.hooks[0].commandWindows, /^node /);
      assert.doesNotMatch(group.hooks[0].commandWindows, /PLUGIN_ROOT|async/);
    }
  }
  const copilot = JSON.parse(readFileSync(join(paths.copilot, "hooks", "hooks.json"), "utf8"));
  assert.ok(existsSync(copilot.hooks.agentStop[0].args[0]));
  assert.ok(existsSync(join(paths.hermes, "__init__.py")));
});
