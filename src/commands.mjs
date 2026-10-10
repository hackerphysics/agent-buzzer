import { spawn } from "node:child_process";

export function runCommand(program, args, { timeoutMs = 120000, cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      windowsHide: true,
      shell: process.platform === "win32" && program !== process.execPath,
      detached: process.platform !== "win32",
      cwd, env,
    });
    let output = "";
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    }
    const timer = setTimeout(() => {
      // Descendants can keep stdout open after their parent exits.
      finish(new Error(`${program} timed out after ${timeoutMs} ms`));
      if (child.pid) {
        if (process.platform === "win32") {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => child.kill());
          killer.unref();
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }, timeoutMs);
    const append = (chunk) => { output = (output + chunk).slice(-10000); };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? null : new Error(output.trim().slice(-800) || `${program} exited with code ${code}`)));
  });
}
