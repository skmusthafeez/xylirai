import {
  defaultModelForProvider,
  resolveProvider,
} from "../lib/openaiChat.mjs";

export function resolveAiRuntime() {
  const provider = resolveProvider({
    provider: process.env.AI_PROVIDER,
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  });
  const apiKey =
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
      : process.env.OPENAI_API_KEY;
  const model =
    provider === "openrouter"
      ? process.env.OPENROUTER_MODEL ||
        process.env.OPENAI_MODEL ||
        process.env.AI_MODEL ||
        defaultModelForProvider(provider)
      : process.env.OPENAI_MODEL ||
        process.env.AI_MODEL ||
        defaultModelForProvider(provider);
  const reasoningEffort =
    provider === "openai" ? process.env.OPENAI_REASONING : undefined;

  return {
    apiKey,
    model,
    provider,
    reasoningEffort,
  };
}

export function missingKeyMessage(provider) {
  if (provider === "openrouter") {
    return "Missing OPENROUTER_API_KEY. Add it in Vercel Project Settings > Environment Variables, then redeploy.";
  }

  return "Missing OPENAI_API_KEY. Add it in Vercel Project Settings > Environment Variables, then redeploy.";
}

export function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req) {
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 7 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
  }

  return raw ? JSON.parse(raw) : {};
}

export function openRouterHeaders(apiKey) {
  const referer = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://xylirai.vercel.app";

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer,
    "X-Title": "xylir 2.0",
  };
}

export function aiRequestHeaders(apiKey, provider) {
  if (provider === "openrouter") {
    return openRouterHeaders(apiKey);
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}
