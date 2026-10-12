function count(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

export function modelMetadata(input = {}) {
  const rawModel = input.model ?? input.modelName ?? input.model_name;
  const model = typeof rawModel === "string" ? rawModel.replace(/[\r\n\0]/g, " ").trim().slice(0, 180) : "";
  const context = input.context && typeof input.context === "object" ? input.context : {};
  const contextTokens = count(input.contextTokens ?? input.context_tokens ?? context.currentTokens ?? context.usedTokens ?? context.used_tokens);
  const contextWindow = count(input.contextWindow ?? input.context_window ?? input.model_context_window ?? context.tokenLimit ?? context.windowTokens ?? context.maxTokens, 1);
  const percent = input.contextPercent ?? input.context_percent ?? context.percent;
  const contextPercent = typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : undefined;
  return {
    ...(model ? { model } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {}),
  };
}
