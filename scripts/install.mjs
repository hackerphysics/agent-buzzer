import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

function exclusiveMarketplace(root, relative) {
  const manifest = JSON.parse(readFileSync(join(root, relative), "utf8"));
  if (manifest.name !== "agent-buzzer-local" || manifest.plugins?.length !== 1 || manifest.plugins[0].name !== "agent-buzzer") {
    throw new Error(`Marketplace at ${root} also owns other plugins; refusing automatic migration`);
  }
}

function installCodex(paths) {
  const marketplace = JSON.parse(run("codex", ["plugin", "marketplace", "list", "--json"], true)).marketplaces
    .find((item) => item.name === "agent-buzzer-local");
  if (marketplace && !samePath(marketplace.root, ROOT)) {
    exclusiveMarketplace(marketplace.root, join(".agents", "plugins", "marketplace.json"));
    const previous = JSON.parse(run("codex", ["plugin", "list", "--marketplace", "agent-buzzer-local", "--json"], true));
    const installed = previous.installed.find((item) => item.pluginId === "agent-buzzer@agent-buzzer-local");
    if (installed) run("codex", ["plugin", "remove", installed.pluginId]);
    run("codex", ["plugin", "marketplace", "remove", "agent-buzzer-local"]);
  }
  if (!marketplace || !samePath(marketplace.root, ROOT)) run("codex", ["plugin", "marketplace", "add", ROOT]);
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
  const existing = JSON.parse(run("copilot", ["plugin", "list", "--json"], true));
  if (existing.some((item) => item.name === "agent-buzzer" && !item.marketplace && item.source === "installed")) {
    throw new Error("A legacy direct AgentBuzzer plugin is still installed. Uninstall it before enabling the marketplace copy.");
  }
  const marketplaces = JSON.parse(run("copilot", ["plugin", "marketplace", "list", "--json"], true));
  const marketplace = marketplaces.find((item) => item.name === "agent-buzzer-local");
  const currentRoot = marketplace?.source?.startsWith("Local: ") ? marketplace.source.slice(7) : null;
  if (marketplace && (!currentRoot || !samePath(currentRoot, ROOT))) {
    if (!marketplace.source.startsWith("Local: ")) throw new Error("AgentBuzzer marketplace is not local; refusing migration");
    exclusiveMarketplace(currentRoot, join(".github", "plugin", "marketplace.json"));
    const installed = existing.find((item) => item.name === "agent-buzzer" && item.marketplace === "agent-buzzer-local");
    if (installed) run("copilot", ["plugin", "uninstall", "agent-buzzer@agent-buzzer-local"]);
    run("copilot", ["plugin", "marketplace", "remove", "agent-buzzer-local"]);
  }
  if (!marketplace || !currentRoot || !samePath(currentRoot, ROOT)) {
    run("copilot", ["plugin", "marketplace", "add", ROOT]);
  }
  const list = JSON.parse(run("copilot", ["plugin", "list", "--json"], true));
  const installed = list.find((item) => item.name === "agent-buzzer" && item.marketplace === "agent-buzzer-local");
  if (installed && !force) {
    if (!installed.enabled) run("copilot", ["plugin", "enable", "agent-buzzer@agent-buzzer-local"]);
    console.log(`Copilot plugin already installed (${installed.version}); use --force to update.`);
    return;
  }
  if (installed) run("copilot", ["plugin", "uninstall", "agent-buzzer@agent-buzzer-local"]);
  run("copilot", ["plugin", "install", "agent-buzzer@agent-buzzer-local"]);
  console.log(`Copilot CLI ${version} installed from ${paths.copilot}.`);
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
