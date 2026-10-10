#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const hook = ["codex-stop", "codex-permission"].includes(args[0]);

function record(status, error) {
  if (!hook) return;
  const message = error?.message || "";
  const reason = !error ? undefined
    : /credential encryption/.test(message) ? "credential_error"
      : /Cannot read AgentBuzzer settings/.test(message) ? "settings_error"
        : error instanceof SyntaxError ? "input_error"
          : error.code === "ERR_MODULE_NOT_FOUND" ? "runtime_error" : "hook_error";
  try {
    const directory = process.env.AGENTBUZZER_CONFIG
      ? dirname(process.env.AGENTBUZZER_CONFIG) : join(homedir(), ".agent-buzzer");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "codex-hook.log");
    if (existsSync(path) && statSync(path).size > 128 * 1024) renameSync(path, `${path}.previous`);
    appendFileSync(path, `${JSON.stringify({
      time: new Date().toISOString(), command: args[0], status, reason,
      code: /^[A-Z0-9_]+$/.test(error?.code || "") ? error.code : undefined,
      pathAvailable: Boolean(process.env.PATH || process.env.Path),
    })}\n`, { mode: 0o600 });
  } catch { /* Diagnostics must not change hook behavior. */ }
}

record("started");
import("../src/cli.mjs").then(({ main }) => main(args)).then(() => record("completed")).catch((error) => {
  record("failed", error);
  console.error(`AgentBuzzer: ${error.message}`);
  process.exitCode = 1;
});
