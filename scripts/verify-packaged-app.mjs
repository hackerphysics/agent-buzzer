import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyPackagedApp(bundle) {
  const runtime = join(bundle, "runtime", process.platform === "win32" ? "node.exe" : "node");
  for (const path of [runtime, join(bundle, "node_modules", "nodemailer", "package.json")]) {
    if (!existsSync(path)) throw new Error(`Missing packaged service dependency: ${path}`);
  }
  const check = `
    import { readFileSync } from "node:fs";
    import { resolve } from "node:path";
    import { pathToFileURL } from "node:url";
    const root = process.argv[1];
    const moduleRoot = resolve(root, "node_modules/nodemailer");
    const manifest = JSON.parse(readFileSync(resolve(moduleRoot, "package.json"), "utf8"));
    const entry = manifest.exports?.["."]?.import || manifest.main;
    const mail = (await import(pathToFileURL(resolve(moduleRoot, entry)))).default;
    const { buildCard } = await import(pathToFileURL(resolve(root, "src/card.mjs")));
    const card = buildCard({ agent: "AgentBuzzer", status: "completed", summary: "Packaging check", sessionName: "Packaging" }, "Build");
    if (card.header.subtitle.content !== "Packaging") throw new Error("Card modules are unavailable");
    const transport = mail.createTransport({ streamTransport: true, buffer: true });
    const result = await transport.sendMail({ from: "check@example.test", to: "check@example.test", subject: "Packaging", text: "AgentBuzzer packaging check" });
    if (!Buffer.isBuffer(result.message) || !result.message.toString().includes("AgentBuzzer packaging check")) throw new Error("Packaged mail runtime is unavailable");
    transport.close();
  `;
  const result = spawnSync(runtime, ["--input-type=module", "-e", check, bundle], { cwd: bundle, encoding: "utf8", windowsHide: true, timeout: 15000, env: { ...process.env, NODE_PATH: "" } });
  if (result.error || result.status !== 0) throw new Error(`Packaged service verification failed: ${result.error?.message || result.stderr?.slice(-2000)}`);
  console.log(`Verified packaged service runtime and dependencies at ${bundle}`);
}

export default async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : join(context.appOutDir, "resources");
  verifyPackagedApp(join(resources, "agent-buzzer"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: verify-packaged-app <service bundle>");
  verifyPackagedApp(resolve(process.argv[2]));
}
