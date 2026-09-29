import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "agent-buzzer@agent-buzzer-local";

function runCli(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args[0]} failed: ${(result.stderr || result.error?.message || "unknown error").trim().slice(-500)}`);
  }
  return result.stdout;
}

export function uninstallAdapter(agent, { run = runCli, env = process.env, home = homedir() } = {}) {
  if (agent === "codex") {
    const list = JSON.parse(run("codex", ["plugin", "list", "--json"]));
    if (!list.installed?.some((item) => item.pluginId === PLUGIN_ID)) return { removed: false };
    run("codex", ["plugin", "remove", PLUGIN_ID]);
    return { removed: true };
  }
  if (agent === "copilot") {
    const list = JSON.parse(run("copilot", ["plugin", "list", "--json"]));
    if (!list.some((item) => item.name === "agent-buzzer" && item.marketplace === "agent-buzzer-local" && item.enabled !== false)) {
      return { removed: false };
    }
    run("copilot", ["plugin", "uninstall", PLUGIN_ID]);
    return { removed: true };
  }
  if (agent === "hermes") {
    const plugins = resolve(env.HERMES_HOME || join(home, ".hermes"), "plugins");
    const target = resolve(plugins, "agent-buzzer");
    if (!target.startsWith(`${plugins}${sep}`)) throw new Error("Invalid Hermes plugin path");
    if (!existsSync(target)) return { removed: false };
    if (lstatSync(target).isSymbolicLink()) throw new Error("Refusing to remove a linked Hermes plugin directory");
    const manifest = readFileSync(join(target, "plugin.yaml"), "utf8");
    if (!/^name:\s*agent-buzzer\s*$/m.test(manifest)) throw new Error("Hermes plugin at target path is not AgentBuzzer");
    run("hermes", ["plugins", "remove", "agent-buzzer"]);
    return { removed: true };
  }
  throw new Error("Unsupported adapter");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = process.argv[2]?.replace(/^--/, "");
  try { console.log(JSON.stringify(uninstallAdapter(agent))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
