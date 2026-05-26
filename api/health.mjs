import { json, resolveAiRuntime } from "./_runtime.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const { apiKey, model, provider } = resolveAiRuntime();

  json(res, 200, {
    ready: Boolean(apiKey),
    model,
    provider,
  });
}
