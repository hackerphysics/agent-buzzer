import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SECRET_DIR = join(homedir(), ".agent-buzzer");
const SECRET_PATH = join(SECRET_DIR, process.platform === "win32" ? "feishu-secret.dpapi" : "feishu-secret.txt");

function powershell(script, input) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
  if (result.error || result.status !== 0) throw new Error("Windows credential encryption failed");
  return result.stdout.trimEnd();
}

export function saveSecret(secret) {
  if (!secret) throw new Error("Cannot save an empty Feishu secret");
  mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(SECRET_DIR, 0o700);
  const value = process.platform === "win32"
    ? powershell("Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $d=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($d))", secret)
    : secret;
  writeFileSync(SECRET_PATH, value, { mode: 0o600 });
  chmodSync(SECRET_PATH, 0o600);
}

export function loadSecret() {
  if (!existsSync(SECRET_PATH)) return undefined;
  if (process.platform !== "win32") return readFileSync(SECRET_PATH, "utf8");
  const script = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($d))";
  return powershell(script, readFileSync(SECRET_PATH, "utf8"));
}
