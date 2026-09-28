import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { ROOT } from "./package-plugins.mjs";

const target = resolve(ROOT, "build", "app");
if (!target.startsWith(`${ROOT}${sep}`)) throw new Error("Invalid staging directory");
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "runtime"), { recursive: true });
for (const name of ["bin", "src", "scripts", "plugins", "package.json"]) {
  cpSync(join(ROOT, name), join(target, name), { recursive: true });
}
mkdirSync(join(target, ".agents", "plugins"), { recursive: true });
copyFileSync(join(ROOT, ".agents", "plugins", "marketplace.json"), join(target, ".agents", "plugins", "marketplace.json"));
mkdirSync(join(target, ".github", "plugin"), { recursive: true });
copyFileSync(join(ROOT, ".github", "plugin", "marketplace.json"), join(target, ".github", "plugin", "marketplace.json"));
const runtime = join(target, "runtime", process.platform === "win32" ? "node.exe" : "node");
copyFileSync(process.execPath, runtime);
if (process.platform !== "win32") chmodSync(runtime, 0o755);
console.log(`Staged ${basename(runtime)} and application at ${target}`);
