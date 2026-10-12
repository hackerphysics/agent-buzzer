import { CHANNELS } from "./config.mjs";
import { buildCard } from "./card.mjs";
import { sendCard } from "./feishu.mjs";
import { sendProvider } from "./channel-providers.mjs";
export { validateEndpoint } from "./channel-schema.mjs";

export function activeChannels(channels) {
  return CHANNELS.filter((name) => channels[name]?.enabled);
}

export async function sendChannel(name, config, event, deviceName, fetchImpl = fetch, context = {}) {
  if (name === "feishu") return sendCard(config, buildCard(event, deviceName), fetchImpl);
  return sendProvider(name, config, event, deviceName, fetchImpl, context);
}
