/** Pure helper for provider brand icon ids (no Vue). */
const KNOWN = new Set([
  "mock-local",
  "openai",
  "deepseek",
  "moonshot",
  "zhipu",
  "siliconflow",
  "openrouter",
  "ollama",
  "custom-openai",
  "anthropic",
  "google",
  "minimax",
  "qwen",
  "grok",
  "mistral",
  "lmstudio",
]);

export function providerIconId(provider) {
  const candidates = [provider.catalogId, provider.id].filter(Boolean);
  for (const id of candidates) {
    if (KNOWN.has(id)) return id;
    const base = id.replace(/-local$/u, "").replace(/-custom$/u, "");
    if (KNOWN.has(base)) return base;
  }
  return "custom-openai";
}
