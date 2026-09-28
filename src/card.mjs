const STATUS = {
  completed: { title: "任务已完成", color: "green" },
  needs_input: { title: "等待你处理", color: "orange" },
  failed: { title: "任务未完成", color: "red" },
};

export function shortSummary(value, fallback = "本轮任务已结束") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const chars = Array.from(text);
  return chars.length > 160 ? `${chars.slice(0, 159).join("")}…` : text;
}

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_\[\]<>]/g, "\\$&");
}

export function buildCard(event, deviceName) {
  const state = STATUS[event.status];
  if (!state) throw new Error("Unsupported notification status");
  const title = `${event.agent} · ${state.title}`;
  const card = {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      summary: { content: `${title} · ${deviceName}` },
    },
    header: {
      title: { tag: "plain_text", content: title },
      subtitle: { tag: "plain_text", content: `AgentBuzzer · ${deviceName}` },
      template: state.color,
    },
    body: {
      direction: "vertical",
      padding: "12px 16px 12px 16px",
      elements: [
        {
          tag: "markdown",
          content: escapeMarkdown(shortSummary(event.summary, state.title)),
        },
      ],
    },
  };
  if (event.url && /^https:\/\//i.test(event.url)) {
    card.body.elements.push({
      tag: "button",
      text: { tag: "plain_text", content: "查看任务" },
      type: "default",
      behaviors: [{ type: "open_url", default_url: event.url }],
    });
  }
  return card;
}
