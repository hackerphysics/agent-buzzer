import assert from "node:assert/strict";
import { chmodSync, copyFileSync, cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import afterPack, { verifyPackagedApp } from "../scripts/verify-packaged-app.mjs";
import { ROOT } from "../scripts/package-plugins.mjs";

test("packaging hook verifies actual resources outside ASAR, not repository dependencies", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-resources-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-resources-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const bundle = join(dir, "resources", "agent-buzzer");
  mkdirSync(join(bundle, "runtime"), { recursive: true });
  const runtime = join(bundle, "runtime", process.platform === "win32" ? "node.exe" : "node");
  copyFileSync(process.execPath, runtime);
  if (process.platform !== "win32") chmodSync(runtime, 0o755);
  cpSync(join(ROOT, "src"), join(bundle, "src"), { recursive: true });
  assert.throws(() => verifyPackagedApp(bundle), /Missing packaged service dependency/);
  mkdirSync(join(bundle, "node_modules"));
  cpSync(join(ROOT, "node_modules", "nodemailer"), join(bundle, "node_modules", "nodemailer"), { recursive: true });
  await afterPack({ appOutDir: dir, electronPlatformName: "win32" });
  await assert.rejects(afterPack({ appOutDir: dir, electronPlatformName: "darwin", packager: { appInfo: { productFilename: "Agent Buzzer" } } }), /Missing packaged service dependency/);
});
