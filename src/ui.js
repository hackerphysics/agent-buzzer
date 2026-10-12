const $ = (id) => document.getElementById(id);
const agentNames = [["Codex", "codex"], ["GitHub Copilot", "copilot"], ["Hermes", "hermes"]];
const weekdays = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [0, "日"]];
let loaded = false;
let saving = false;
let currentSettings;
let pendingRemoval;
let refreshing = false;
let adaptersChecking = true;
let channelCatalog = [];
let selectedChannel = location.hash.slice(1).split("/")[1] || "feishu";
let pendingTestChannel;
let deliveryStates = {};
const channelDrafts = new Map();
const pageTitles = { overview: "概览", timing: "时间策略", channels: "通知通道", adapters: "适配器" };
let currentPage = pageTitles[location.hash.slice(1).split("/")[0]] ? location.hash.slice(1).split("/")[0] : "overview";

function selectPage(page) {
  const requested = page.split("/");
  page = requested[0];
  currentPage = pageTitles[page] ? page : "overview";
  if (currentPage === "channels" && channelCatalog.some(({ id }) => id === requested[1])) selectedChannel = requested[1];
  for (const name of Object.keys(pageTitles)) $("page-" + name).hidden = name !== currentPage;
  for (const button of document.querySelectorAll(".nav-item")) {
    const selected = button.dataset.page === currentPage;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("page-title").textContent = pageTitles[currentPage];
  $("feedback").textContent = "";
  if (loaded && currentPage === "channels") renderChannelEditor();
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
  $("enabled").checked = settings.notifications.enabled;
  $("dnd").checked = settings.notifications.dnd;
  $("hours-enabled").checked = settings.notifications.workHours.enabled;
  $("hours-start").value = settings.notifications.workHours.start;
  $("hours-end").value = settings.notifications.workHours.end;
  $("cycle-enabled").checked = settings.notifications.cycle.enabled;
  $("work-minutes").value = settings.notifications.cycle.workMinutes;
  $("break-minutes").value = settings.notifications.cycle.breakMinutes;
  $("device-name").value = settings.deviceName;
  if (!loaded) renderChoices(settings);
  else {
    for (const [agent, key] of agentNames) $(`agent-${key}`).checked = settings.notifications.agents[agent];
    for (const day of $("weekdays").querySelectorAll("input")) day.checked = settings.notifications.workHours.days.includes(Number(day.value));
  }
  loaded = true;
  $("save-device").disabled = false;
  for (const control of document.querySelectorAll(".page input, .page select, .primary-button")) control.disabled = false;
  renderChannelEditor();
  showFields();
}

function showFields() {
  $("hours-fields").hidden = !$("hours-enabled").checked;
  $("cycle-fields").hidden = !$("cycle-enabled").checked;
}

function formData() {
  return {
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path.startsWith("/api/install/") || path.startsWith("/api/uninstall/") ? 125000 : options?.method === "PUT" ? 30000 : 10000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("请求超时，请点击刷新重试");
    throw error;
  } finally { clearTimeout(timer); }
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
    for (const [key, value] of Object.entries(data.settings.notifications)) currentSettings.notifications[key] = value;
    $("feedback").textContent = data.discarded ? `已保存，丢弃 ${data.discarded} 条待发消息` : "已保存";
    await refresh();
  } catch (error) { $("feedback").textContent = error.message; }
  finally { saving = false; $("save").disabled = false; $("save-timing").disabled = false; }
}

function renderChannelNavigation() {
  const list = $("channel-list");
  const scroll = list.scrollTop;
  const picker = $("channel-picker");
  list.replaceChildren(); picker.replaceChildren();
  let group;
  for (const definition of channelCatalog) {
    if (group !== definition.group) { group = definition.group; list.append(element("h3", "channel-group", group)); }
    const status = currentSettings.channels[definition.id];
    const button = element("button", "channel-tab", definition.label);
    button.type = "button";
    button.dataset.channel = definition.id;
    button.classList.toggle("active", definition.id === selectedChannel);
    button.classList.toggle("channel-on", status.enabled);
    button.setAttribute("aria-current", definition.id === selectedChannel ? "page" : "false");
    button.addEventListener("click", () => {
      selectedChannel = definition.id;
      location.hash = `channels/${definition.id}`;
      renderChannelEditor();
    });
    list.append(button);
    const option = element("option", null, definition.label);
    option.value = definition.id; picker.append(option);
  }
  picker.value = selectedChannel;
  list.scrollTop = scroll;
}

function renderChannelResult() {
  const status = deliveryStates[selectedChannel];
  $("channel-result").classList.toggle("failed", status?.state === "failed");
  $("channel-result").textContent = !status ? "" : `${status.state === "sent" ? "已投递" : status.state === "sending" ? "投递中" : status.reason === "MATRIX_ENCRYPTED_ROOM" ? "Matrix 加密房间不支持直接投递" : "投递失败，待重试"}${status.httpStatus ? ` · HTTP ${status.httpStatus}` : ""} · ${new Date(status.time).toLocaleTimeString()}`;
}

function renderChannelEditor() {
  if (!channelCatalog.length || !currentSettings) return;
  if (!channelCatalog.some(({ id }) => id === selectedChannel)) selectedChannel = channelCatalog[0].id;
  renderChannelNavigation();
  const definition = channelCatalog.find(({ id }) => id === selectedChannel);
  const status = currentSettings.channels[selectedChannel];
  const draft = channelDrafts.get(selectedChannel) || {};
  $("channel-title").textContent = definition.label;
  $("channel-state").textContent = status.enabled ? status.configured ? "已启用" : "待配置" : "已关闭";
  $("channel-enabled").checked = draft.enabled ?? status.enabled;
  $("channel-enabled").disabled = false;
  const fields = $("channel-fields"); fields.replaceChildren();
  for (const spec of definition.fields) {
    const label = element("label", "channel-field");
    const caption = element("span", "field-caption", spec.required ? spec.label : `${spec.label}（可选）`);
    const input = element(spec.type === "select" ? "select" : "input");
    input.id = `channel-${selectedChannel}-${spec.name}`;
    input.name = spec.name;
    input.setAttribute("aria-label", spec.label);
    label.htmlFor = input.id;
    if (spec.options) for (const option of spec.options) { const node = element("option", null, option); node.value = option; input.append(node); }
    else input.type = spec.type;
    if (spec.min !== undefined) input.min = String(spec.min);
    if (spec.max !== undefined) input.max = String(spec.max);
    input.autocomplete = spec.secret ? "new-password" : "off";
    input.value = draft[spec.name] ?? (spec.secret ? "" : status[spec.name] ?? spec.default ?? "");
    input.placeholder = spec.secret && status[`${spec.name}Configured`] ? "保持不变" : "";
    if (spec.secret) {
      const presence = element("small", "credential-state", draft[spec.name] === null ? "待清除" : status[`${spec.name}FromEnv`] ? "环境变量" : status[`${spec.name}Configured`] ? "已配置" : "未配置");
      presence.id = `${input.id}-state`;
      input.setAttribute("aria-describedby", presence.id);
      input.disabled = status[`${spec.name}FromEnv`] === true;
      caption.append(presence);
      if (status[`${spec.name}Configured`] && !status[`${spec.name}FromEnv`]) {
        const clear = element("button", "text-button clear-credential", "清除");
        clear.type = "button";
        clear.setAttribute("aria-label", `清除 ${spec.label}`);
        clear.addEventListener("click", () => {
          channelDrafts.set(selectedChannel, { ...collectChannel(), [spec.name]: null, ...(spec.required ? { enabled: false } : {}) });
          renderChannelEditor();
        });
        caption.append(clear);
      }
    }
    input.addEventListener("input", () => { channelDrafts.set(selectedChannel, collectChannel()); $("test-channel").disabled = true; });
    input.addEventListener("change", () => { channelDrafts.set(selectedChannel, collectChannel()); $("test-channel").disabled = true; });
    label.append(caption, input); fields.append(label);
  }
  $("save").disabled = saving;
  $("test-channel").disabled = saving || !status.enabled || !status.configured || channelDrafts.has(selectedChannel);
  renderChannelResult();
}

function collectChannel() {
  const definition = channelCatalog.find(({ id }) => id === selectedChannel);
  const draft = channelDrafts.get(selectedChannel) || {};
  const value = { enabled: $("channel-enabled").checked };
  for (const spec of definition.fields) {
    const text = $(`channel-${selectedChannel}-${spec.name}`).value;
    if (spec.secret) { if (text) value[spec.name] = text; else if (draft[spec.name] === null) value[spec.name] = null; }
    else value[spec.name] = spec.type === "number" && text !== "" ? Number(text) : text.trim();
  }
  return value;
}

async function saveChannel(payload = collectChannel()) {
  if (saving) return;
  const channel = selectedChannel;
  saving = true; $("save").disabled = true; $("channel-enabled").disabled = true;
  $("feedback").textContent = "保存中…";
  try {
    const result = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channels: { [channel]: payload } }) });
    currentSettings = result.settings;
    channelDrafts.delete(channel);
    $("feedback").textContent = result.discarded ? `已保存，丢弃 ${result.discarded} 条待发消息` : "已保存";
    renderChannelEditor();
    await refresh();
  } catch (error) {
    $("feedback").textContent = error.message;
    $("channel-enabled").checked = currentSettings.channels[channel].enabled;
  } finally { saving = false; renderChannelEditor(); }
}

async function testChannel(channel = selectedChannel) {
  if (saving) return;
  $("test-channel").disabled = true;
  try {
    const result = await api(`/api/channels/${channel}/test`, { method: "POST" });
    $("feedback").textContent = result.disposition === "dropped" ? "测试通知已丢弃" : "测试通知已加入队列";
    await refresh();
  } catch (error) { $("feedback").textContent = error.message; }
  finally { renderChannelEditor(); }
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
    if (entry.pendingChannels?.length) row.append(element("small", "muted", entry.pendingChannels.map((name) => channelCatalog.find(({ id }) => id === name)?.label || name).join(" · ")));
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

function renderAdapters(adapters, checking, failed) {
  const container = $("adapters");
  container.replaceChildren();
  $("codex-guide").hidden = !adapters?.codex?.installed;
  for (const [name, key] of agentNames) {
    const status = adapters?.[key];
    const known = Boolean(status);
    const row = element("div", "adapter-row");
    const left = element("div");
    left.append(element("b", null, name), element("small", null, !known ? failed ? "检测失败" : "检测中…" : status.installed ? "已安装" : status.available ? "未安装" : "CLI 不可用"));
    const button = element("button", "outline-button", status?.installed ? "更新" : "安装");
    button.disabled = !status?.available || (!known && checking);
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
    if (key === "codex" && status?.installed) {
      const guideButton = element("button", "text-button", "授权步骤");
      guideButton.type = "button";
      guideButton.addEventListener("click", showCodexGuide);
      actions.append(guideButton);
    }
    actions.append(button);
    if (status?.installed) {
      const removeButton = element("button", "remove-button", "移除");
      removeButton.type = "button";
      removeButton.disabled = !status.available;
      removeButton.addEventListener("click", () => {
        pendingRemoval = { key, name, button: removeButton };
        $("remove-title").textContent = `移除 ${name} 适配器？`;
        $("remove-details").textContent = `只移除 ${name} 中的 AgentBuzzer 插件，并丢弃该 Agent 的待发消息。其他适配器和通知通道保持不变；已有会话可能要重启 ${name} 才会停止旧 Hook。`;
        $("remove-dialog").returnValue = "";
        $("remove-dialog").showModal();
      });
      actions.append(removeButton);
    }
    row.append(left, actions);
    container.append(row);
  }
}

$("remove-dialog").addEventListener("close", async () => {
  const target = pendingRemoval;
  pendingRemoval = null;
  if ($("remove-dialog").returnValue !== "remove" || !target) return;
  target.button.disabled = true;
  target.button.textContent = "移除中…";
  try {
    const result = await api(`/api/uninstall/${target.key}`, { method: "POST" });
    const count = result.discarded ? `，丢弃 ${result.discarded} 条待发消息` : "";
    $("feedback").textContent = result.removed ? `${target.name} 适配器已移除${count}` : `${target.name} 未安装${count}`;
    await refresh();
  } catch (error) {
    $("feedback").textContent = error.message;
    target.button.disabled = false;
    target.button.textContent = "移除";
  }
});

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api("/api/state");
    $("connection").textContent = "服务运行中";
    $("connection").classList.add("online");
    if ($("feedback").dataset.networkError === "true") {
      $("feedback").textContent = "";
      delete $("feedback").dataset.networkError;
    }
    currentSettings = data.settings;
    channelCatalog = data.channelCatalog || [];
    deliveryStates = data.channelDelivery || {};
    if (!loaded) fill(data.settings);
    else { renderChannelNavigation(); renderChannelResult(); }
    renderQueue(data.queue);
    adaptersChecking = data.adaptersChecking === true;
    renderAdapters(data.adapters, adaptersChecking, data.adaptersError);
    const n = data.settings.notifications;
    const subtitles = {
      overview: !n.enabled ? "通知已关闭" : n.dnd || (n.cycle.enabled && data.cycle.phase === "break") ? "勿扰中 · 消息待补发" : "通知已开启",
      timing: n.workHours.enabled ? `${n.workHours.start}–${n.workHours.end} · ${n.workHours.days.length} 天` : "未设置工作时段",
      channels: `${Object.values(data.settings.channels).filter((channel) => channel.enabled).length} 个通道已开启`,
      adapters: !data.adapters ? data.adaptersError ? "适配器检测失败" : "正在检测适配器" : `${Object.values(data.adapters).filter((adapter) => adapter.installed).length} 个适配器已安装`,
    };
    $("summary").textContent = subtitles[currentPage];
    $("phase").textContent = n.cycle.enabled ? `${data.cycle.phase === "break" ? "Break" : "Work"} · 下次切换 ${new Date(data.cycle.until).toLocaleTimeString()}` : "";
  } catch (error) {
    $("connection").textContent = "服务不可用";
    $("connection").classList.remove("online");
    $("feedback").textContent = error.message;
    $("feedback").dataset.networkError = "true";
    if (!loaded) $("summary").textContent = "设置加载失败，请刷新重试";
  } finally { refreshing = false; }
}

for (const id of ["enabled", "dnd"]) {
  $(id).addEventListener("change", () => { showFields(); void quickSwitch(id); });
}
for (const id of ["hours-enabled", "cycle-enabled"]) $(id).addEventListener("change", showFields);
$("channel-form").addEventListener("submit", (event) => { event.preventDefault(); void saveChannel(); });
$("channel-enabled").addEventListener("change", () => { if (saving) return; void saveChannel($("channel-enabled").checked ? collectChannel() : { enabled: false }); });
$("channel-picker").addEventListener("change", () => { selectedChannel = $("channel-picker").value; location.hash = `channels/${selectedChannel}`; renderChannelEditor(); });
$("test-channel").addEventListener("click", () => {
  if (channelCatalog.find(({ id }) => id === selectedChannel)?.paid) { pendingTestChannel = selectedChannel; $("test-dialog").returnValue = ""; $("test-dialog").showModal(); }
  else void testChannel();
});
$("test-dialog").addEventListener("close", () => { const channel = pendingTestChannel; pendingTestChannel = null; if ($("test-dialog").returnValue === "send" && channel) void testChannel(channel); });
$("save-device").addEventListener("click", async () => {
  $("save-device").disabled = true;
  try {
    const result = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceName: $("device-name").value.trim() }) });
    currentSettings = result.settings; $("feedback").textContent = "设备名称已保存";
  } catch (error) { $("feedback").textContent = error.message; }
  finally { $("save-device").disabled = false; }
});
$("save-timing").addEventListener("click", save);
$("refresh").addEventListener("click", refresh);
for (const button of document.querySelectorAll(".nav-item")) button.addEventListener("click", () => { location.hash = button.dataset.page; selectPage(button.dataset.page); });
window.addEventListener("hashchange", () => selectPage(location.hash.slice(1)));
selectPage(currentPage);
for (const control of document.querySelectorAll(".page input, .page select, .primary-button")) control.disabled = true;
$("save-device").disabled = true;
$("test-channel").disabled = true;
void refresh();
setInterval(() => { if (!saving) void refresh(); }, 8000);
setInterval(() => { if (adaptersChecking && !saving) void refresh(); }, 1000);
