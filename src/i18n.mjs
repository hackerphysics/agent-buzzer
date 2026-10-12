export const LANGUAGES = ["zh-CN", "en"];
export function normalizeLanguage(value) { return typeof value === "string" && /^en(?:-|$)/i.test(value) ? "en" : "zh-CN"; }

export const ENGLISH = {
  "语言": "Language", "语言已保存": "Language saved", "设置页面": "Settings pages",
  "概览": "Overview", "时间策略": "Timing", "通知通道": "Notification Channels", "适配器": "Adapters",
  "正在读取设置": "Loading settings", "连接中": "Connecting", "刷新": "Refresh",
  "发送控制": "Delivery Controls", "通知": "Notifications", "关闭后丢弃新事件及待发消息": "When off, new events and queued messages are discarded",
  "勿扰": "Do Not Disturb", "暂存消息，恢复后补发": "Queue messages and replay them when resumed",
  "待发消息": "Pending Messages", "当前没有待发消息": "No pending messages",
  "时间策略设置": "Timing settings", "工作时段": "Working Hours", "时段外的新事件直接丢弃": "New events outside working hours are discarded",
  "开始": "Start", "结束": "End", "工作日": "Working days", "工作 / 休息": "Work / Break",
  "Break 中的新事件重置休息计时": "New events during a break reset the break timer",
  "工作（分钟）": "Work (minutes)", "休息（分钟）": "Break (minutes)", "保存时间策略": "Save Timing",
  "设备设置": "Device settings", "设备名称": "Device Name", "保存设备名称": "Save Device Name", "通道": "Channel",
  "启用当前通道": "Enable current channel", "JSON 预览": "JSON Preview", "保存通道设置": "Save Channel", "发送测试通知": "Send Test",
  "Agent 适配器": "Agent adapters", "Codex Hook 启用步骤": "Codex Hook Approval",
  "重新打开 Codex，在新会话中输入": "Reopen Codex. In a new chat, enter", "逐项查看并信任 AgentBuzzer 的": "Review and trust AgentBuzzer's",
  "和": "and", "Hook。": "hooks.", "再完成一轮对话，确认收到通知。": "Finish a conversation turn and confirm that you receive a notification.",
  "安装插件不等于授权 Hook。更新后若 Hook 定义发生变化，Codex 会要求重新审查。": "Installing a plugin does not approve its hooks. Codex may ask you to review changed hooks after an update.",
  "取消": "Cancel", "移除插件": "Remove Plugin", "发送短信测试通知？": "Send a Test SMS?",
  "Twilio 可能按短信条数和目的地收取费用。": "Twilio may charge by message segment and destination.", "发送": "Send", "。": ".",
  "请求超时，请点击刷新重试": "Request timed out. Refresh to retry.", "保存中…": "Saving...", "已保存": "Saved",
  "已保存，丢弃 {count} 条待发消息": "Saved. Discarded {count} pending messages", "已丢弃 {count} 条待发消息": "Discarded {count} pending messages",
  "已投递": "Delivered", "投递中": "Sending", "投递失败，待重试": "Delivery failed; waiting to retry",
  "Matrix 加密房间不支持直接投递": "Direct delivery to encrypted Matrix rooms is unsupported",
  "已启用": "Enabled", "待配置": "Needs configuration", "已关闭": "Off", "恢复默认": "Reset Defaults",
  "AgentBuzzer 字段": "AgentBuzzer Field", "目标 JSON 路径": "Destination JSON Path", "{field} 目标 JSON 路径": "Destination JSON path for {field}",
  "{label}（可选）": "{label} (optional)", "保持不变": "Keep unchanged", "待清除": "Will be cleared", "环境变量": "Environment variable",
  "已配置": "Configured", "未配置": "Not configured", "清除": "Clear", "清除 {label}": "Clear {label}",
  "测试通知已丢弃": "Test notification discarded", "测试通知已加入队列": "Test notification queued", "重试 {count} 次": "Retried {count} times",
  "检测失败": "Detection failed", "检测中…": "Checking...", "已安装": "Installed", "未安装": "Not installed", "CLI 不可用": "CLI unavailable",
  "更新": "Update", "安装": "Install", "处理中…": "Working...", "重试": "Retry", "授权步骤": "Hook Approval", "移除": "Remove", "移除中…": "Removing...",
  "Codex 插件已安装，请在 Codex 中审查 Hook": "Codex plugin installed. Review its hooks in Codex", "{agent} 适配器已安装": "{agent} adapter installed",
  "移除 {agent} 适配器？": "Remove the {agent} Adapter?",
  "只移除 {agent} 中的 AgentBuzzer 插件，并丢弃该 Agent 的待发消息。其他适配器和通知通道保持不变；已有会话可能要重启 {agent} 才会停止旧 Hook。": "Remove only the AgentBuzzer plugin in {agent} and discard that Agent's pending messages. Other adapters and notification channels are unchanged. Restart existing {agent} sessions to unload cached hooks.",
  "{agent} 适配器已移除{count}": "{agent} adapter removed{count}", "{agent} 未安装{count}": "{agent} is not installed{count}",
  "，丢弃 {count} 条待发消息": "; discarded {count} pending messages", "{agent} 通知": "{agent} notifications",
  "服务运行中": "Service running", "服务不可用": "Service unavailable", "通知已关闭": "Notifications off", "通知已开启": "Notifications on",
  "勿扰中 · 消息待补发": "Paused · messages queued", "{start}–{end} · {count} 天": "{start}–{end} · {count} days",
  "未设置工作时段": "No working hours set", "{count} 个通道已开启": "{count} channels enabled", "正在检测适配器": "Checking adapters",
  "适配器检测失败": "Adapter detection failed", "{count} 个适配器已安装": "{count} adapters installed", "{phase} · 下次切换 {time}": "{phase} · next switch {time}",
  "工作": "Work", "休息": "Break", "设置加载失败，请刷新重试": "Settings failed to load. Refresh to retry.", "设备名称已保存": "Device name saved",
  "一": "Mon", "二": "Tue", "三": "Wed", "四": "Thu", "五": "Fri", "六": "Sat", "日": "Sun",
  "协作与聊天": "Collaboration & Chat", "国内机器人": "Chinese Bots", "移动推送": "Mobile Push", "邮件与短信": "Email & SMS", "桥接与自定义": "Bridges & Custom",
  "飞书应用": "Feishu App", "飞书群机器人": "Feishu Group Bot", "钉钉群机器人": "DingTalk Bot", "企业微信群机器人": "WeCom Bot",
  "邮件 SMTP": "Email (SMTP)", "短信 Twilio": "SMS (Twilio)", "通用 Webhook": "Generic Webhook", "Hermes 发送桥接": "Hermes Send Bridge",
  "服务地址": "Server URL", "接收者类型": "Recipient Type", "接收者 ID": "Recipient ID", "签名密钥": "Signing Secret", "加签密钥": "Signing Secret",
  "优先级": "Priority", "传输加密": "Transport Encryption", "用户名": "Username", "密码 / App Password": "Password / App Password",
  "发件人邮箱": "Sender Email", "收件人邮箱": "Recipient Email", "发送号码": "Sender Number", "接收号码": "Recipient Number",
  "消息格式": "Message Format", "标准消息 v1": "Standard Message v1", "旧格式：event + deviceName": "Legacy: event + deviceName",
  "字段映射": "Field Mapping", "投递目标": "Delivery Target", "Hermes 可执行文件": "Hermes Executable",
  "Agent 名称": "Agent Name", "通知 App 名称": "Notification App Name", "会话名称": "Session Name", "结果详情": "Result Details",
  "完成时间": "Completed At", "事件 ID": "Event ID", "会话 ID": "Session ID", "轮次 ID": "Turn ID", "任务状态": "Task Status",
  "发生时间": "Occurred At", "接口版本": "Schema Version", "结束时间": "Ended At", "查看任务": "View Task",
  "任务已完成": "Task completed", "等待你处理": "Waiting for your input", "任务未完成": "Task not completed",
  "已完成": "Completed", "等待处理": "Waiting for input", "未完成": "Not completed", "Context 窗口": "Context Window",
  "本轮任务已结束": "This task turn has ended", "有操作需要你批准": "An operation needs your approval",
  "Copilot 正在等待你处理": "Copilot is waiting for your input", "Hermes 正在等待你处理": "Hermes is waiting for your input",
  "任务状态已更新": "Task status updated", "本轮已中断": "This turn was interrupted", "本轮未完成": "This turn did not complete",
  "这是一条 AgentBuzzer 测试通知。": "This is an AgentBuzzer test notification.", "这是一条测试通知。": "This is a test notification.", "示例会话": "Example Session",
};

const SINGULAR = {
  "已保存，丢弃 {count} 条待发消息": "Saved. Discarded {count} pending message", "已丢弃 {count} 条待发消息": "Discarded {count} pending message",
  "重试 {count} 次": "Retried {count} time", "，丢弃 {count} 条待发消息": "; discarded {count} pending message",
  "{start}–{end} · {count} 天": "{start}–{end} · {count} day", "{count} 个通道已开启": "{count} channel enabled", "{count} 个适配器已安装": "{count} adapter installed",
};
export function translate(source, language = "zh-CN", params = {}) {
  source = String(source ?? "");
  const text = normalizeLanguage(language) === "en" ? (params.count === 1 && Object.hasOwn(SINGULAR, source) ? SINGULAR[source] : Object.hasOwn(ENGLISH, source) ? ENGLISH[source] : source) : source;
  return text.replace(/\{([A-Za-z]+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
}

const SUMMARY_KEYS = new Set(["本轮任务已结束", "有操作需要你批准", "Copilot 正在等待你处理", "Hermes 正在等待你处理", "任务状态已更新", "任务已完成", "本轮已中断", "本轮未完成", "这是一条 AgentBuzzer 测试通知。", "这是一条测试通知。"]);
export function eventSummary(event, language = "zh-CN", fallback = "任务状态已更新") {
  return SUMMARY_KEYS.has(event.summaryKey) ? translate(event.summaryKey, language) : event.summary || translate(fallback, language);
}
export function summaryKey(value) { return SUMMARY_KEYS.has(value) ? value : undefined; }

const ERRORS = {
  "Invalid language": "不支持的语言", "Invalid settings": "设置格式无效", "Invalid device name": "设备名称无效",
  "Failed to fetch": "无法连接本地服务", "agents must be an object": "agents 必须为对象",
  "Invalid notification settings": "通知设置无效", "Invalid channels": "通道设置无效", "Unknown channel": "未知通知通道",
  "Invalid channel settings": "通道设置无效", "Unknown channel field": "未知通道字段", "Invalid agent switch": "Agent 开关无效",
  "Invalid notification URL": "通知地址无效", "Invalid JSON input": "JSON 格式无效", "JSON request required": "请求必须使用 JSON",
  "Request is too large": "请求内容过大", "Local access only": "仅允许本地访问", "Invalid agent event": "Agent 事件无效",
  "Channel configuration is incomplete": "通道配置不完整", "Adapter detection failed": "适配器检测失败", "Unsupported adapter": "不支持的适配器",
  "Adapter removal is already running": "适配器正在移除中", "Invalid uninstall result": "卸载结果无效",
  "Cannot read AgentBuzzer settings": "无法读取 AgentBuzzer 设置", "Cannot read notification credentials": "无法读取通知凭据",
  "Cannot decrypt notification credentials": "无法解密通知凭据", "Windows credential encryption failed": "Windows 凭据加密失败",
  "Invalid credential key": "凭据字段无效", "Invalid credential value": "凭据值无效", "Invalid credential store": "凭据存储格式无效",
  "Invalid Feishu recipient type": "飞书接收者类型无效", "Configure SMTP password before enabling authentication": "启用 SMTP 认证前请配置密码",
  "Notification URL must use HTTPS without embedded credentials (local servers may use HTTP)": "通知地址必须使用 HTTPS，且不能含嵌入式凭据（本地服务器可用 HTTP）",
  "Server URL must not contain query credentials": "服务器地址不能包含查询参数凭据",
  "Slack requires a Slack Incoming Webhook URL": "Slack 需要 Incoming Webhook 地址", "Discord requires a Discord Webhook URL": "Discord 需要官方 Webhook 地址",
  "Teams requires a Power Automate Workflows webhook": "Teams 需要 Power Automate Workflows Webhook 地址", "Google Chat requires a space webhook URL": "Google Chat 需要空间 Webhook 地址",
  "Feishu requires a group-bot webhook URL": "飞书需要群机器人 Webhook 地址", "DingTalk requires a robot webhook URL": "钉钉需要机器人 Webhook 地址", "WeCom requires a group-bot webhook URL": "企业微信需要群机器人 Webhook 地址",
  "Matrix requires a Room ID, not a room alias": "Matrix 需要房间 ID，不能使用房间别名", "Invalid Telegram Bot Token": "Telegram Bot Token 无效", "Invalid Telegram Chat ID": "Telegram Chat ID 无效",
  "Invalid ntfy Topic": "ntfy Topic 无效", "Invalid LINE recipient ID": "LINE 接收者 ID 无效", "Invalid Twilio Account SID": "Twilio Account SID 无效",
  "SMS numbers must use E.164 format": "短信号码必须使用 E.164 格式", "Invalid email address": "邮箱地址无效", "Invalid SMTP host": "SMTP 服务器地址无效",
  "Invalid Hermes delivery target": "Hermes 投递目标无效", "Hermes program must be an executable path, not a shell command": "Hermes 必须指定可执行文件路径，不能使用 Shell 命令",
  "Select a Hermes executable, not a general-purpose shell": "请选择 Hermes 可执行文件，而非通用 Shell",
  "Invalid Webhook field mapping": "Webhook 字段映射无效", "Invalid Webhook field mapping environment variable": "Webhook 字段映射环境变量无效",
  "workHours.days must contain unique weekdays 0-6": "工作日必须使用不重复的 0–6 数值", "Working hours must have distinct HH:MM start and end times": "工作时段起止时间必须采用 HH:MM 格式，且不能相同",
  "SMTP authentication failed": "SMTP 认证失败", "SMTP timed out": "SMTP 请求超时", "SMTP connection or TLS failed": "SMTP 连接或 TLS 失败", "SMTP delivery failed": "SMTP 投递失败",
  "Hermes notification timed out": "Hermes 通知超时", "Hermes executable is unavailable": "Hermes 可执行文件不可用", "Hermes delivery failed": "Hermes 投递失败",
  "Previous service is still stopping": "旧通知服务仍在退出中", "Local notification service did not start": "本地通知服务未能启动",
};

export function translateError(message, language = "zh-CN") {
  const english = normalizeLanguage(language) === "en";
  if (Object.hasOwn(ERRORS, message)) return english ? message : ERRORS[message];
  const configure = /^Configure (.+): (.+)$/.exec(message);
  if (configure) return english ? `Configure ${translate(configure[1], language)}: ${translate(configure[2], language)}` : `请配置${configure[1]}：${configure[2]}`;
  const conflict = /^Conflicting Webhook paths: (.+)$/.exec(message);
  if (conflict) return english ? message : `Webhook 目标路径冲突：${conflict[1]}`;
  const path = /^Invalid Webhook path: (.+)$/.exec(message);
  if (path) return english ? message : `Webhook 目标路径无效：${path[1]}`;
  const field = /^Invalid (.+)$/.exec(message);
  if (field) return english ? `Invalid ${translate(field[1], language)}` : `${field[1]}无效`;
  const provider = /^(.+) (request failed|returned an invalid response|rejected the notification|configuration is incomplete)$/.exec(message);
  if (provider) {
    const suffix = { "request failed": "请求失败", "returned an invalid response": "响应格式无效", "rejected the notification": "拒绝了通知", "configuration is incomplete": "配置不完整" };
    return english ? `${translate(provider[1], language)} ${provider[2]}` : `${provider[1]}${suffix[provider[2]]}`;
  }
  const http = /^(.+) HTTP (\d{3})$/.exec(message);
  if (http) return `${translate(http[1], language)} HTTP ${http[2]}`;
  const boolean = /^(.+) must be a boolean$/.exec(message);
  if (boolean && !english) return `${boolean[1]}必须为布尔值`;
  const duration = /^(\w+(?:Minutes)?) must be between 1 and 1440$/.exec(message);
  if (duration && !english) return `${duration[1]}必须在 1–1440 之间`;
  return translate(message, language);
}
