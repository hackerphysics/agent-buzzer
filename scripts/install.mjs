import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packagePlugins, ROOT } from "./package-plugins.mjs";

const force = process.argv.includes("--force");
const selected = process.argv.filter((item) => ["--codex", "--copilot", "--hermes"].includes(item));
const all = selected.length === 0;
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function run(program, args, capture = false) {
  const result = spawnSync(program, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    windowsHide: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args.slice(0, 2).join(" ")} failed`);
  }
  return result.stdout;
}

function installCodex(paths) {
  run("codex", ["plugin", "marketplace", "add", ROOT]);
  const list = JSON.parse(run("codex", ["plugin", "list", "--marketplace", "agent-buzzer-local", "--json"], true));
  const installed = list.installed.find((item) => item.pluginId === "agent-buzzer@agent-buzzer-local");
  if (installed && !force) {
    console.log(`Codex plugin already installed (${installed.version}); use --force to update.`);
    return;
  }
  if (installed) run("codex", ["plugin", "remove", installed.pluginId]);
  run("codex", ["plugin", "add", "agent-buzzer", "--marketplace", "agent-buzzer-local"]);
  console.log(`Codex ${version} installed from ${paths.codex}. Review its two hooks in /hooks.`);
}

function installCopilot(paths) {
  const list = JSON.parse(run("copilot", ["plugin", "list", "--json"], true));
  const installed = list.find((item) => item.name === "agent-buzzer" && item.source === "installed");
  if (installed && !force) {
    console.log(`Copilot plugin already installed (${installed.version}); use --force to update.`);
    return;
  }
  if (installed) run("copilot", ["plugin", "uninstall", "agent-buzzer"]);
  run("copilot", ["plugin", "install", paths.copilot]);
  console.log(`Copilot CLI ${version} installed.`);
}

function installHermes(paths) {
  const root = process.env.HERMES_HOME || join(homedir(), ".hermes");
  const plugins = join(root, "plugins");
  const destination = join(plugins, "agent-buzzer");
  if (existsSync(destination) && !force) {
    console.log("Hermes plugin already exists; use --force to update.");
  } else {
    if (existsSync(destination)) {
      const manifest = readFileSync(join(destination, "plugin.yaml"), "utf8");
      if (!/^name:\s*agent-buzzer\s*$/m.test(manifest)) {
        throw new Error("Existing Hermes plugin is not AgentBuzzer; refusing to overwrite it");
      }
    }
    mkdirSync(plugins, { recursive: true });
    cpSync(paths.hermes, destination, { recursive: true, force: true });
    console.log(`Hermes ${version} copied to ${destination}.`);
  }
  run("hermes", ["plugins", "enable", "agent-buzzer"]);
}

const paths = packagePlugins();
if (all || selected.includes("--codex")) installCodex(paths);
if (all || selected.includes("--copilot")) installCopilot(paths);
if (all || selected.includes("--hermes")) installHermes(paths);
