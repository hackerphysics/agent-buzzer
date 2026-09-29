import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { ROOT } from "./package-plugins.mjs";

const target = resolve(ROOT, "build", "app");
if (!target.startsWith(`${ROOT}${sep}`)) throw new Error("Invalid staging directory");
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, "runtime"), { recursive: true });
const icon = readFileSync(join(ROOT, "src", "icon.svg"), "utf8");
function renderIcon(size) {
  return new Resvg(icon, { fitTo: { mode: "width", value: size } }).render().asPng();
}
writeFileSync(join(ROOT, "build", "icon.png"), renderIcon(1024));
const linuxIcons = join(ROOT, "build", "icons");
mkdirSync(linuxIcons, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
  writeFileSync(join(linuxIcons, `${size}x${size}.png`), renderIcon(size));
}
for (const name of ["bin", "src", "scripts", "plugins", "package.json"]) {
  cpSync(join(ROOT, name), join(target, name), { recursive: true });
}
writeFileSync(join(target, "src", "icon.png"), renderIcon(256));
mkdirSync(join(target, ".agents", "plugins"), { recursive: true });
copyFileSync(join(ROOT, ".agents", "plugins", "marketplace.json"), join(target, ".agents", "plugins", "marketplace.json"));
mkdirSync(join(target, ".github", "plugin"), { recursive: true });
copyFileSync(join(ROOT, ".github", "plugin", "marketplace.json"), join(target, ".github", "plugin", "marketplace.json"));
const runtime = join(target, "runtime", process.platform === "win32" ? "node.exe" : "node");
copyFileSync(process.execPath, runtime);
if (process.platform !== "win32") chmodSync(runtime, 0o755);
console.log(`Staged ${basename(runtime)} and application at ${target}`);
