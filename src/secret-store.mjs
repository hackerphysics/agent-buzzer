import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
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

export function hasSecret() {
  return existsSync(SECRET_PATH);
}

const credentialCache = new Map();

function credentialPath(env) {
  return join(env.AGENTBUZZER_CONFIG ? dirname(env.AGENTBUZZER_CONFIG) : SECRET_DIR, "credentials.json");
}

function credentialStore(env) {
  const path = credentialPath(env);
  try {
    const stat = statSync(path);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const previous = credentialCache.get(path);
    if (previous?.stamp === stamp) return previous;
    const document = JSON.parse(readFileSync(path, "utf8"));
    if (document.version !== 1 || !Array.isArray(document.fields)) throw new Error("Invalid credential store");
    const entry = { stamp, document, values: undefined };
    credentialCache.set(path, entry);
    return entry;
  } catch (error) {
    if (error.code === "ENOENT") return { document: { version: 1, fields: [], values: {} }, values: {} };
    throw new Error("Cannot read notification credentials");
  }
}

export function credentialKeys(env = process.env) {
  return new Set(credentialStore(env).document.fields);
}

export function loadCredential(key, env = process.env) {
  const store = credentialStore(env);
  if (!store.document.fields.includes(key)) return undefined;
  if (!store.values) {
    try {
      store.values = store.document.protected
        ? JSON.parse(Buffer.from(powershell("Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($d))", store.document.protected), "base64").toString("utf8"))
        : store.document.values;
    } catch { throw new Error("Cannot decrypt notification credentials"); }
  }
  return store.values?.[key];
}

export function saveCredentials(changes, env = process.env) {
  const path = credentialPath(env);
  const previous = existsSync(path) ? readFileSync(path) : null;
  const store = credentialStore(env);
  const values = Object.fromEntries(store.document.fields.map((key) => [key, loadCredential(key, env)]));
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error("Invalid credential key");
    if (value !== null && (typeof value !== "string" || value.length > 8192)) throw new Error("Invalid credential value");
    if (value == null || value === "") delete values[key];
    else values[key] = value;
  }
  const document = { version: 1, fields: Object.keys(values).sort() };
  if (process.platform === "win32") {
    document.protected = powershell("Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $d=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($d))", Buffer.from(JSON.stringify(values), "utf8").toString("base64"));
  } else document.values = values;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(document), { mode: 0o600, flag: "wx", flush: true });
  renameSync(temporary, path);
  credentialCache.delete(path);
  return () => {
    if (previous) {
      const backup = `${path}.${randomUUID()}.tmp`;
      writeFileSync(backup, previous, { mode: 0o600, flag: "wx", flush: true });
      renameSync(backup, path);
    } else if (existsSync(path)) unlinkSync(path);
    credentialCache.delete(path);
  };
}
