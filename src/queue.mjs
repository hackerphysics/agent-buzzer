import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { configPath } from "./config.mjs";

export function dataPath(name, env = process.env) {
  return join(dirname(configPath(env)), name);
}

export function queueDir(env = process.env) {
  return dataPath("queue", env);
}

export function makeEntry(event, now = Date.now(), pendingChannels) {
  return {
    id: `${String(now).padStart(15, "0")}-${randomUUID()}`,
    event: {
      agent: event.agent,
      status: event.status,
      summary: event.summary,
      key: event.key,
      url: event.url,
    },
    createdAt: new Date(now).toISOString(),
    pendingChannels,
    attempts: 0,
    nextAttemptAt: 0,
  };
}

export function persistEntry(entry, env = process.env) {
  const directory = queueDir(env);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${entry.id}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600, flag: "wx", flush: true });
  renameSync(temporary, path);
  return path;
}

export function listEntries(env = process.env) {
  let files;
  try {
    files = readdirSync(queueDir(env)).filter((name) => /^\d{15}-[a-f0-9-]+\.json$/.test(name)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return files.map((name) => {
    const path = join(queueDir(env), name);
    try { return { ...JSON.parse(readFileSync(path, "utf8")), path }; }
    catch { return null; }
  }).filter(Boolean);
}

export function removeEntry(entry) {
  try { unlinkSync(entry.path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

export function updateEntry(entry) {
  const { path, ...value } = entry;
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx", flush: true });
  renameSync(temporary, path);
}

export function purgeDisabled(notifications, channels, env = process.env) {
  let count = 0;
  for (const entry of listEntries(env)) {
    if (!notifications.enabled || notifications.agents[entry.event.agent] === false) {
      removeEntry(entry);
      count++;
    } else if (entry.pendingChannels) {
      const remaining = entry.pendingChannels.filter((name) => channels[name]?.enabled);
      if (!remaining.length) { removeEntry(entry); count++; }
      else if (remaining.length !== entry.pendingChannels.length) updateEntry({ ...entry, pendingChannels: remaining });
    }
  }
  return count;
}

export function purgeAgent(agent, env = process.env) {
  let count = 0;
  for (const entry of listEntries(env)) {
    if (entry.event.agent !== agent) continue;
    removeEntry(entry);
    count++;
  }
  return count;
}
