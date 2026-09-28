const BASE = "https://open.feishu.cn/open-apis";

async function postJson(url, payload, headers, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new Error(`Feishu request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Feishu HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`Feishu API ${result.code}: ${result.msg || "unknown error"}`);
  return result;
}

export async function getTenantToken(feishu, fetchImpl = fetch) {
  if (!feishu.appId || !feishu.appSecret) {
    throw new Error("Set AGENTBUZZER_FEISHU_APP_ID and AGENTBUZZER_FEISHU_APP_SECRET");
  }
  const result = await postJson(`${BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: feishu.appId,
    app_secret: feishu.appSecret,
  }, {}, fetchImpl);
  if (!result.tenant_access_token) throw new Error("Feishu did not return a tenant access token");
  return result.tenant_access_token;
}

export async function sendCard(feishu, card, fetchImpl = fetch) {
  if (!feishu.receiveId) {
    throw new Error("Set Feishu receiveId in ~/.agent-buzzer/config.json or AGENTBUZZER_FEISHU_RECEIVE_ID");
  }
  const token = await getTenantToken(feishu, fetchImpl);
  const url = `${BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(feishu.receiveIdType)}`;
  const response = await postJson(url, {
    receive_id: feishu.receiveId,
    msg_type: "interactive",
    content: JSON.stringify(card),
  }, { Authorization: `Bearer ${token}` }, fetchImpl);
  return response.data?.message_id;
}
