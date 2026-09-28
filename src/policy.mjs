import { AGENTS, notificationSettings } from "./config.mjs";

function minutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function validateNotifications(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid notification settings");
  const n = notificationSettings(value);
  for (const field of ["enabled", "dnd", "workHours.enabled", "cycle.enabled"]) {
    const [section, key] = field.split(".");
    const raw = key ? value[section]?.[key] : value[section];
    if (raw !== undefined && typeof raw !== "boolean") throw new Error(`${field} must be a boolean`);
  }
  if (value.agents !== undefined && (!value.agents || typeof value.agents !== "object" || Array.isArray(value.agents))) {
    throw new Error("agents must be an object");
  }
  for (const [agent, enabled] of Object.entries(value.agents || {})) {
    if (!AGENTS.includes(agent) || typeof enabled !== "boolean") throw new Error("Invalid agent switch");
  }
  if (!Array.isArray(n.workHours.days) || n.workHours.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(n.workHours.days).size !== n.workHours.days.length) {
    throw new Error("workHours.days must contain unique weekdays 0-6");
  }
  if (!Number.isFinite(minutes(n.workHours.start)) || !Number.isFinite(minutes(n.workHours.end)) || n.workHours.start === n.workHours.end) {
    throw new Error("Working hours must have distinct HH:MM start and end times");
  }
  for (const key of ["workMinutes", "breakMinutes"]) {
    if (!Number.isInteger(n.cycle[key]) || n.cycle[key] < 1 || n.cycle[key] > 1440) {
      throw new Error(`${key} must be between 1 and 1440`);
    }
  }
  return n;
}

export function withinWorkHours(hours, now = new Date()) {
  if (!hours.enabled) return true;
  const time = now.getHours() * 60 + now.getMinutes();
  const start = minutes(hours.start);
  const end = minutes(hours.end);
  if (start < end) return hours.days.includes(now.getDay()) && time >= start && time < end;
  const yesterday = (now.getDay() + 6) % 7;
  return (hours.days.includes(now.getDay()) && time >= start) || (hours.days.includes(yesterday) && time < end);
}

export function ingressDecision(notifications, agent, now = new Date()) {
  if (!notifications.enabled || notifications.agents[agent] === false) return "disabled";
  if (!withinWorkHours(notifications.workHours, now)) return "outside_hours";
  return "queue";
}

export function deliveryDecision(notifications, agent, phase, now = new Date()) {
  if (!notifications.enabled || notifications.agents[agent] === false) return "drop";
  if (!withinWorkHours(notifications.workHours, now) || notifications.dnd || (notifications.cycle.enabled && phase === "break")) return "wait";
  return "send";
}

export function advanceCycle(settings, state, now = Date.now()) {
  if (!settings.enabled) return { phase: "work", until: null };
  if (!state?.until || !["work", "break"].includes(state.phase)) {
    return { phase: "work", until: now + settings.workMinutes * 60000 };
  }
  if (now < state.until) return state;
  const phase = state.phase === "work" ? "break" : "work";
  return { phase, until: now + settings[phase === "work" ? "workMinutes" : "breakMinutes"] * 60000 };
}

export function resetBreak(settings, state, now = Date.now()) {
  return settings.enabled && state.phase === "break"
    ? { phase: "break", until: now + settings.breakMinutes * 60000 }
    : state;
}
