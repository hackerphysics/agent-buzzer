const $ = (id) => document.getElementById(id);
const agentNames = [["Codex", "codex"], ["GitHub Copilot", "copilot"], ["Hermes", "hermes"]];
const weekdays = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]];
let loaded = false;
let saving = false;
let currentSettings;
const pageTitles = { overview: "概览", timing: "时间策略", channels: "通知通道", adapters: "适配器" };
let currentPage = pageTitles[location.hash.slice(1)] ? location.hash.slice(1) : "overview";

function selectPage(page) {
  currentPage = pageTitles[page] ? page : "overview";
  for (const name of Object.keys(pageTitles)) $("page-" + name).hidden = name !== currentPage;
  for (const button of document.querySelectorAll(".nav-item")) {
    const selected = button.dataset.page === currentPage;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("page-title").textContent = pageTitles[currentPage];
  $("feedback").textContent = "";
  if (loaded) void refresh();
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function toggle(id, checked, label) {
  const wrapper = element("label", "switch");
  const input = element("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  input.setAttribute("aria-label", label);
  wrapper.append(input, element("span"));
  return wrapper;
}

function renderChoices(settings) {
  const list = $("agent-list");
  for (const [agent, key] of agentNames) {
    const row = element("div", "row agent-row");
    const name = element("b", null, agent);
    const label = element("div");
    label.append(name);
    row.append(label, toggle(`agent-${key}`, settings.notifications.agents[agent], `${agent} 通知`));
    list.append(row);
    row.querySelector("input").addEventListener("change", () => void quickSwitch(`agent-${key}`));
  }
  const days = $("weekdays");
  for (const [day, text] of weekdays) {
    const label = element("label", "day");
    const input = element("input");
    input.type = "checkbox";
    input.value = String(day);
    input.checked = settings.notifications.workHours.days.includes(day);
    label.append(input, element("span", null, text));
    days.append(label);
  }
}

function fill(settings) {
  $("device-label").textContent = settings.deviceName;
  $("enabled").checked = settings.notifications.enabled;
  $("dnd").checked = settings.notifications.dnd;
  $("hours-enabled").checked = settings.notifications.workHours.enabled;
  $("hours-start").value = settings.notifications.workHours.start;
  $("hours-end").value = settings.notifications.workHours.end;
  $("cycle-enabled").checked = settings.notifications.cycle.enabled;
  $("work-minutes").value = settings.notifications.cycle.workMinutes;
  $("break-minutes").value = settings.notifications.cycle.breakMinutes;
  $("device-name").value = settings.deviceName;
  $("feishu-enabled").checked = settings.channels.feishu.enabled;
  $("webhook-enabled").checked = settings.channels.webhook.enabled;
  $("slack-enabled").checked = settings.channels.slack.enabled;
  $("app-id").value = settings.channels.feishu.appId;
  $("recipient-type").value = settings.channels.feishu.receiveIdType;
  $("recipient-id").value = settings.channels.feishu.receiveId;
  $("app-secret").value = "";
  $("webhook-url").value = "";
  $("slack-url").value = "";
  $("secret-state").textContent = settings.channels.feishu.secretConfigured ? "密钥已配置" : "密钥未配置";
  $("webhook-state").textContent = settings.channels.webhook.urlConfigured ? "地址已配置" : "地址未配置";
  $("slack-state").textContent = settings.channels.slack.urlConfigured ? "地址已配置" : "地址未配置";
  if (!loaded) renderChoices(settings);
  else {
    for (const [agent, key] of agentNames) $(`agent-${key}`).checked = settings.notifications.agents[agent];
    for (const day of $("weekdays").querySelectorAll("input")) day.checked = settings.notifications.workHours.days.includes(Number(day.value));
  }
  loaded = true;
  showFields();
}

function showFields() {
  $("hours-fields").hidden = !$("hours-enabled").checked;
  $("cycle-fields").hidden = !$("cycle-enabled").checked;
  for (const name of ["feishu", "webhook", "slack"]) $(`${name}-fields`).hidden = !$(`${name}-enabled`).checked;
}

function formData() {
  return {
    deviceName: $("device-name").value.trim(),
    channels: {
      feishu: {
        enabled: $("feishu-enabled").checked,
        appId: $("app-id").value.trim(),
        receiveId: $("recipient-id").value.trim(),
        receiveIdType: $("recipient-type").value,
        ...($("app-secret").value ? { secret: $("app-secret").value } : {}),
      },
      webhook: { enabled: $("webhook-enabled").checked, ...($("webhook-url").value ? { url: $("webhook-url").value.trim() } : {}) },
      slack: { enabled: $("slack-enabled").checked, ...($("slack-url").value ? { url: $("slack-url").value.trim() } : {}) },
    },
    notifications: {
      enabled: $("enabled").checked,
      dnd: $("dnd").checked,
      agents: Object.fromEntries(agentNames.map(([name, key]) => [name, $(`agent-${key}`).checked])),
      workHours: {
        enabled: $("hours-enabled").checked,
        start: $("hours-start").value,
        end: $("hours-end").value,
        days: [...$("weekdays").querySelectorAll("input:checked")].map((input) => Number(input.value)),
      },
      cycle: {
        enabled: $("cycle-enabled").checked,
        workMinutes: Number($("work-minutes").value),
        breakMinutes: Number($("break-minutes").value),
      },
    },
  };
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function save() {
  if (saving) return;
  saving = true;
  $("save").disabled = true;
  $("save-timing").disabled = true;
  $("feedback").textContent = "保存中…";
  try {
    const data = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData()) });
    currentSettings = data.settings;
    fill(data.settings);
    $("feedback").textContent = data.discarded ? `已保存，丢弃 ${data.discarded} 条待发消息` : "已保存";
    await refresh();
  } catch (error) { $("feedback").textContent = error.message; }
  finally { saving = false; $("save").disabled = false; $("save-timing").disabled = false; }
}

async function quickSwitch(id) {
  if (saving || !currentSettings) return;
  const input = $(id);
  const enabled = input.checked;
  let payload;
  if (["enabled", "dnd"].includes(id)) payload = { notifications: { ...currentSettings.notifications, [id]: enabled } };
  else if (id.startsWith("agent-")) {
    const agent = agentNames.find(([, key]) => `agent-${key}` === id)?.[0];
    payload = { notifications: { ...currentSettings.notifications, agents: { ...currentSettings.notifications.agents, [agent]: enabled } } };
  } else {
    const channel = id.replace("-enabled", "");
    payload = { channels: { [channel]: { enabled } } };
  }
  saving = true;
  try {
    const result = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    currentSettings = result.settings;
    $("feedback").textContent = result.discarded ? `已丢弃 ${result.discarded} 条待发消息` : "已保存";
    await refresh();
  } catch (error) {
    input.checked = !enabled;
    $("feedback").textContent = error.message;
  } finally { saving = false; showFields(); }
}

function renderQueue(queue) {
  $("queue-count").textContent = String(queue.length);
  const container = $("queue");
  container.replaceChildren();
  if (!queue.length) return container.append(element("p", "empty", "当前没有待发消息"));
  for (const entry of queue) {
    const row = element("div", "queue-row");
    const top = element("div", "queue-top");
    top.append(element("b", null, entry.agent), element("time", null, new Date(entry.createdAt).toLocaleString()));
    row.append(top, element("p", null, entry.summary));
    if (entry.pendingChannels?.length) row.append(element("small", "muted", entry.pendingChannels.join(" · ")));
    if (entry.attempts) row.append(element("small", "muted", `重试 ${entry.attempts} 次`));
    container.append(row);
  }
}

function showCodexGuide() {
  const guide = $("codex-guide");
  guide.hidden = false;
  guide.open = true;
  guide.querySelector("summary").focus();
  guide.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderAdapters(adapters) {
  const container = $("adapters");
  container.replaceChildren();
  $("codex-guide").hidden = !adapters?.codex?.installed;
  for (const [name, key] of agentNames) {
    const status = adapters?.[key] || { available: false, installed: false };
    const row = element("div", "adapter-row");
    const left = element("div");
    left.append(element("b", null, name), element("small", status.installed ? "已安装" : status.available ? "未安装" : "CLI 不可用"));
    const button = element("button", "outline-button", status.installed ? "更新" : "安装");
    button.disabled = !status.available;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "处理中…";
      try {
        await api(`/api/install/${key}`, { method: "POST" });
        $("feedback").textContent = key === "codex" ? "Codex 插件已安装，请在 Codex 中审查 Hook" : `${name} 适配器已安装`;
        await refresh();
        if (key === "codex") showCodexGuide();
      } catch (error) { $("feedback").textContent = error.message; button.disabled = false; button.textContent = "重试"; }
    });
    const actions = element("div", "adapter-actions");
    if (key === "codex" && status.installed) {
      const guideButton = element("button", "text-button", "授权步骤");
      guideButton.type = "button";
      guideButton.addEventListener("click", showCodexGuide);
      actions.append(guideButton);
    }
    actions.append(button);
    row.append(left, actions);
    container.append(row);
  }
}

async function refresh() {
  try {
    const data = await api("/api/state");
    $("connection").textContent = "服务运行中";
    $("connection").classList.add("online");
    if ($("feedback").dataset.networkError === "true") {
      $("feedback").textContent = "";
      delete $("feedback").dataset.networkError;
    }
    currentSettings = data.settings;
    if (!loaded) fill(data.settings);
    renderQueue(data.queue);
    renderAdapters(data.adapters);
    const n = data.settings.notifications;
    const subtitles = {
      overview: !n.enabled ? "通知已关闭" : n.dnd || (n.cycle.enabled && data.cycle.phase === "break") ? "勿扰中 · 消息待补发" : "通知已开启",
      timing: n.workHours.enabled ? `${n.workHours.start}–${n.workHours.end} · ${n.workHours.days.length} 天` : "未设置工作时段",
      channels: `${Object.values(data.settings.channels).filter((channel) => channel.enabled).length} 个通道已开启`,
      adapters: `${Object.values(data.adapters || {}).filter((adapter) => adapter.installed).length} 个适配器已安装`,
    };
    $("summary").textContent = subtitles[currentPage];
    $("phase").textContent = n.cycle.enabled ? `${data.cycle.phase === "break" ? "Break" : "Work"} · 下次切换 ${new Date(data.cycle.until).toLocaleTimeString()}` : "";
  } catch (error) {
    $("connection").textContent = "服务不可用";
    $("connection").classList.remove("online");
    $("feedback").textContent = error.message;
    $("feedback").dataset.networkError = "true";
  }
}

for (const id of ["enabled", "dnd", "feishu-enabled", "webhook-enabled", "slack-enabled"]) {
  $(id).addEventListener("change", () => { showFields(); void quickSwitch(id); });
}
for (const id of ["hours-enabled", "cycle-enabled"]) $(id).addEventListener("change", showFields);
$("save").addEventListener("click", save);
$("save-timing").addEventListener("click", save);
$("refresh").addEventListener("click", refresh);
for (const button of document.querySelectorAll(".nav-item")) button.addEventListener("click", () => { location.hash = button.dataset.page; selectPage(button.dataset.page); });
window.addEventListener("hashchange", () => selectPage(location.hash.slice(1)));
selectPage(currentPage);
void refresh();
setInterval(() => { if (!saving) void refresh(); }, 8000);
