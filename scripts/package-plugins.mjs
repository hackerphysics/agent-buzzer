import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function bundle(source, destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(ROOT, "plugins", source), destination, { recursive: true, force: true });
  cpSync(join(ROOT, "bin"), join(destination, "bin"), { recursive: true, force: true });
  cpSync(join(ROOT, "src"), join(destination, "src"), { recursive: true, force: true });
  cpSync(join(ROOT, "scripts"), join(destination, "scripts"), { recursive: true, force: true });
  cpSync(join(ROOT, "plugins"), join(destination, "plugins"), { recursive: true, force: true });
  cpSync(join(ROOT, "package.json"), join(destination, "package.json"), { force: true });
  for (const [folder, file] of [[".agents/plugins", "marketplace.json"], [".github/plugin", "marketplace.json"]]) {
    const target = join(destination, folder);
    mkdirSync(target, { recursive: true });
    cpSync(join(ROOT, folder, file), join(target, file), { force: true });
  }
  return destination;
}

export function packagePlugins() {
  const nodeBinary = process.env.AGENTBUZZER_NODE || process.execPath;
  const codex = bundle("codex", join(ROOT, ".agents", "plugins", "agent-buzzer"));
  const copilot = bundle("copilot", join(ROOT, "dist", "copilot-plugin"));
  const hermes = bundle("hermes", join(ROOT, "dist", "hermes-plugin"));
  const codexHookFile = join(codex, "hooks", "hooks.json");
  const codexHooks = JSON.parse(readFileSync(codexHookFile, "utf8"));
  for (const [eventName, groups] of Object.entries(codexHooks.hooks)) {
    const action = eventName === "Stop" ? "codex-stop" : "codex-permission";
    for (const group of groups) {
      for (const hook of group.hooks) {
        hook.command = `"${nodeBinary}" "${join(ROOT, "bin", "agent-buzzer.mjs")}" ${action}`;
        hook.commandWindows = hook.command;
      }
    }
  }
  writeFileSync(codexHookFile, `${JSON.stringify(codexHooks, null, 2)}\n`);
  const hookFile = join(copilot, "hooks", "hooks.json");
  const hooks = JSON.parse(readFileSync(hookFile, "utf8"));
  for (const entries of Object.values(hooks.hooks)) {
    for (const entry of entries) {
      entry.exec = nodeBinary;
      entry.args[0] = join(copilot, "bin", "agent-buzzer.mjs");
    }
  }
  writeFileSync(hookFile, `${JSON.stringify(hooks, null, 2)}\n`);
  const hermesEntry = join(hermes, "__init__.py");
  writeFileSync(hermesEntry, readFileSync(hermesEntry, "utf8").replace('NODE_BINARY = "node"', `NODE_BINARY = ${JSON.stringify(nodeBinary)}`));
  return { codex, copilot, hermes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(packagePlugins());
}
