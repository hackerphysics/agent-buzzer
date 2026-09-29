const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const { chmodSync, cpSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const url = "http://127.0.0.1:38147";
const single = app.requestSingleInstanceLock();
let window;
if (!single) app.quit();
else app.on("second-instance", () => { window?.show(); window?.focus(); });

async function serviceReady() {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    if (response.ok) {
      const status = await response.json();
      if (status.service === "agent-buzzer") return status;
    }
  } catch { /* Spawn the bundled service below. */ }
  return null;
}

async function launchService() {
  const source = join(process.resourcesPath, "agent-buzzer");
  const version = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
  const { buildId } = await import(pathToFileURL(join(source, "src", "build-id.mjs")));
  const fingerprint = buildId(source);
  const existing = await serviceReady();
  if (existing?.version === version && existing.buildId === fingerprint) return;
  if (existing) {
    await fetch(`${url}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) });
    for (let i = 0; i < 30; i++) {
      if (!(await serviceReady())) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (await serviceReady()) throw new Error("Previous service is still stopping");
  }
  const destination = join(homedir(), ".agent-buzzer", `app-${version}-${fingerprint}`);
  mkdirSync(join(homedir(), ".agent-buzzer"), { recursive: true });
  if (!existsSync(join(destination, "bin", "agent-buzzer.mjs"))) cpSync(source, destination, { recursive: true });
  const node = join(destination, "runtime", process.platform === "win32" ? "node.exe" : "node");
  if (process.platform !== "win32") chmodSync(node, 0o755);
  const child = spawn(node, [join(destination, "bin", "agent-buzzer.mjs"), "serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 35; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if ((await serviceReady())?.buildId === fingerprint) return;
  }
  throw new Error("Local notification service did not start");
}

if (single) app.whenReady().then(async () => {
  try {
    await launchService();
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      width: 1080, height: 780, minWidth: 360, minHeight: 480,
      title: "AgentBuzzer", backgroundColor: "#f5f7f6",
      icon: join(process.resourcesPath, "agent-buzzer", "src", "icon.png"),
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    if (process.platform !== "darwin") window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => { if (!target.startsWith(`${url}/`)) event.preventDefault(); });
    await window.loadURL(url);
    window.on("closed", () => { window = null; });
  } catch (error) { console.error(error); dialog.showErrorBox("AgentBuzzer", error.message); app.quit(); }
});

app.on("window-all-closed", () => app.quit());
