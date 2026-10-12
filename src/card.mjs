import { eventText, eventTime } from "./webhook.mjs";
import { modelMetadata } from "./model-metadata.mjs";
import { eventSummary, normalizeLanguage, translate } from "./i18n.mjs";

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

function footer(event, deviceName, context) {
  const language = normalizeLanguage(context.language);
  const device = eventText(deviceName, 100).replace(/[\r\n]/g, " ");
  const lines = [device ? `AgentBuzzer · ${device}` : "AgentBuzzer"];
  const timestamp = eventTime(event.occurredAt, eventTime(context.createdAt, null));
  if (timestamp) {
    const time = new Intl.DateTimeFormat(language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(timestamp));
    lines.push(`${translate(event.status === "completed" ? "完成时间" : event.status === "failed" ? "结束时间" : "发生时间", language)}${language === "en" ? ": " : "："}${time}`);
  }
  const { model, contextTokens, contextWindow, contextPercent } = modelMetadata(event);
  const metadata = [];
  if (model) metadata.push(`Model: ${model}`);
  const number = (value) => value.toLocaleString("en-US");
  const percentValue = contextTokens !== undefined && contextWindow !== undefined ? contextTokens / contextWindow * 100 : contextPercent;
  const percent = percentValue !== undefined ? ` (${Math.round(percentValue * 10) / 10}%)` : "";
  if (contextTokens !== undefined) {
    const window = contextWindow !== undefined ? ` / ${number(contextWindow)}` : "";
    metadata.push(`Context: ${number(contextTokens)}${window} tokens${percent}`);
  } else if (contextWindow !== undefined) metadata.push(`${translate("Context 窗口", language)}: ${number(contextWindow)} tokens${percent}`);
  else if (contextPercent !== undefined) metadata.push(`Context: ${Math.round(contextPercent * 10) / 10}%`);
  if (metadata.length) lines.push(metadata.join(" · "));
  return lines.join("\n");
}

export function buildCard(event, deviceName, context = {}) {
  const language = normalizeLanguage(context.language);
  const state = STATUS[event.status];
  if (!state) throw new Error("Unsupported notification status");
  const title = `${event.agent} · ${translate(state.title, language)}`;
  const sessionName = eventText(event.sessionName, 256);
  const card = {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      summary: { content: `${title} · ${deviceName}` },
    },
    header: {
      title: { tag: "plain_text", content: title },
      ...(sessionName ? { subtitle: { tag: "plain_text", content: sessionName } } : {}),
      template: state.color,
    },
    body: {
      direction: "vertical",
      padding: "12px 16px 12px 16px",
      elements: [
        {
          tag: "markdown",
          content: escapeMarkdown(shortSummary(eventSummary(event, language, state.title), translate(state.title, language))),
        },
      ],
    },
  };
  if (event.url && /^https:\/\//i.test(event.url)) {
    card.body.elements.push({
      tag: "button",
      text: { tag: "plain_text", content: translate("查看任务", language) },
      type: "default",
      behaviors: [{ type: "open_url", default_url: event.url }],
    });
  }
  card.body.elements.push({
    tag: "div",
    text: { tag: "plain_text", content: footer(event, deviceName, context), text_size: "notation", text_color: "grey" },
    margin: "8px 0px 0px 0px",
  });
  return card;
}
