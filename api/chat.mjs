import {
  ChatInputError,
  PROVIDERS,
  buildProviderRequest,
  formatSseEvent,
  getProviderErrorMessage,
  providerStreamToClientEvents,
} from "../lib/openaiChat.mjs";
import {
  aiRequestHeaders,
  json,
  missingKeyMessage,
  readJsonBody,
  resolveAiRuntime,
} from "./_runtime.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const { apiKey, model, provider, reasoningEffort } = resolveAiRuntime();

  if (!apiKey) {
    json(res, 500, { error: missingKeyMessage(provider) });
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
      json(res, error.status, { error: error.message });
      return;
    }

    json(res, 400, { error: "Invalid JSON body." });
    return;
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
      headers: aiRequestHeaders(apiKey, provider),
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      sendEvent(res, "error", {
        error: await getProviderErrorMessage(response, provider),
      });
      return;
    }

    for await (const clientEvent of providerStreamToClientEvents(
      response,
      provider,
      abortController.signal
    )) {
      sendEvent(res, clientEvent.event, clientEvent.data);
    }
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
