import http from "node:http";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChatInputError,
  PROVIDERS,
  buildProviderRequest,
  defaultModelForProvider,
  formatSseEvent,
  getProviderErrorMessage,
  providerStreamToClientEvents,
  resolveProvider,
} from "./lib/openaiChat.mjs";
import {
  MediaInputError,
  buildPollinationsUrl,
  mediaResponseHeaders,
} from "./lib/pollinationsMedia.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 3000);
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
const reasoningEffort = provider === "openai" ? process.env.OPENAI_REASONING : "";
const pollinationsKey = process.env.POLLINATIONS_API_KEY;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ready: Boolean(apiKey),
        model,
        provider,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      await handleGenerate(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/media") {
      await handleMedia(url, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: error?.message || "Unexpected server error.",
      });
    } else {
      res.end();
    }
  }
});

async function handleGenerate(req, res) {
  const body = await readJsonBody(req);
  const prompt = String(body?.prompt || "").trim();
  const kind = String(body?.kind || "image").toLowerCase();
  const query = new URLSearchParams({ kind, prompt });
  const model = String(body?.model || "").trim();

  if (model) {
    query.set("model", model);
  }

  try {
    buildPollinationsUrl({ kind, prompt, model });
  } catch (error) {
    if (error instanceof MediaInputError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }

    throw error;
  }

  sendJson(res, 200, {
    kind,
    prompt,
    url: `/api/media?${query.toString()}`,
  });
}

async function handleMedia(url, res) {
  try {
    const { url: mediaUrl, contentType } = buildPollinationsUrl({
      kind: url.searchParams.get("kind"),
      prompt: url.searchParams.get("prompt"),
      model: url.searchParams.get("model"),
    });

    const response = await fetchPollinationsMedia(mediaUrl);

    if (!response.ok || !response.body) {
      const errorMessage = await getMediaErrorMessage(response);
      sendJson(res, response.status || 502, {
        error:
          errorMessage ||
          `Pollinations request failed with status ${response.status}.`,
      });
      return;
    }

    res.writeHead(200, mediaResponseHeaders(response.headers.get("content-type") || contentType));

    for await (const chunk of response.body) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    if (error instanceof MediaInputError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }

    throw error;
  }
}

async function handleChat(req, res) {
  if (!apiKey) {
    sendJson(res, 500, {
      error:
        provider === "openrouter"
          ? "Missing OPENROUTER_API_KEY. Create a .env file from .env.example and restart the server."
          : "Missing OPENAI_API_KEY. Create a .env file from .env.example and restart the server.",
    });
    return;
  }

  let payload;

  try {
    const body = await readJsonBody(req);

    payload = buildProviderRequest({
      provider,
      messages: body?.messages,
      model,
      reasoningEffort,
    });
  } catch (error) {
    if (error instanceof ChatInputError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }

    throw error;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  try {
    const response = await fetch(PROVIDERS[provider].endpoint, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      sendEvent(res, "error", {
        error: await getProviderErrorMessage(response, provider),
      });
      return;
    }

    await relayOpenAIStream(response, res, abortController.signal);
  } catch (error) {
    if (!abortController.signal.aborted) {
      sendEvent(res, "error", {
        error: error?.message || "Something went wrong while generating.",
      });
    }
  } finally {
    res.end();
  }
}

function sendEvent(res, event, data) {
  res.write(formatSseEvent(event, data));
}

function requestHeaders() {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "xylir 2.0";
  }

  return headers;
}

function pollinationsHeaders() {
  return pollinationsKey
    ? {
        Authorization: `Bearer ${pollinationsKey}`,
      }
    : {};
}

async function fetchPollinationsMedia(mediaUrl) {
  const headers = pollinationsHeaders();
  const hasAuth = Boolean(headers.Authorization);
  let response = await fetch(mediaUrl, { headers });

  if (hasAuth && response.status === 402) {
    response = await fetch(mediaUrl);
  }

  return response;
}

async function relayOpenAIStream(response, res, signal) {
  for await (const clientEvent of providerStreamToClientEvents(
    response,
    provider,
    signal
  )) {
    sendEvent(res, clientEvent.event, clientEvent.data);
  }
}

async function serveStatic(pathname, res) {
  const decoded = decodeURIComponent(pathname);
  const requestedPath = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    const data = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  }
}

async function readJsonBody(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 7 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(payload));
}

async function getMediaErrorMessage(response) {
  try {
    const json = await response.json();
    if (json?.error) return String(json.error);
    if (json?.message) return String(json.message);
  } catch {
    // Fall through to text parsing.
  }

  try {
    const text = (await response.text()).trim();
    return text || "";
  } catch {
    return "";
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };

  return types[extension] || "application/octet-stream";
}

function loadDotEnv(filePath) {
  try {
    const data = readFileSync(filePath, "utf8");
    for (const line of data.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
      process.env[key.trim()] ||= value;
    }
  } catch {
    // .env is optional during first run.
  }
}

server.listen(port, () => {
  console.log(`xylir 2.0 is running at http://localhost:${port}`);
});
