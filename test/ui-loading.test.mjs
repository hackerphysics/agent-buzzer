import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { normalizeLanguage, translate, translateError, eventSummary } from "../src/i18n.mjs";

for (const language of ["zh-CN", "en"]) test(`UI bounds stalled requests and shows a localized retry state (${language})`, async () => {
  const nodes = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let requests = 0;
  const context = createContext({
    AbortController,
    normalizeLanguage, translate, translateError, eventSummary,
    document: {
      documentElement: { lang: language },
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { textContent: "", dataset: {}, addEventListener() {}, classList: { add() {}, remove() {} } });
        return nodes.get(id);
      },
      querySelectorAll: () => [],
    },
    window: { addEventListener() {} },
    location: { hash: "" },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    setInterval() {},
    fetch: (_path, { signal }) => {
      requests++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
  });
  runInContext(readFileSync(new URL("../src/ui.js", import.meta.url), "utf8").replace(/^import[^\n]+\n/, ""), context);
  assert.equal(requests, 1);
  await runInContext("refresh()", context);
  assert.equal(requests, 1);
  const timeout = [...timers.values()][0];
  assert.equal(timeout.delay, 10000);
  timeout.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes.get("connection").textContent, translate("服务不可用", language));
  assert.equal(nodes.get("summary").textContent, translate("设置加载失败，请刷新重试", language));
  assert.equal(nodes.get("feedback").textContent, translate("请求超时，请点击刷新重试", language));
  assert.equal(timers.size, 0);
  const retry = runInContext("refresh()", context);
  assert.equal(requests, 2);
  [...timers.values()][0].callback();
  await retry;
});
