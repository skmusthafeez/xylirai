import {
  ChatInputError,
  PROVIDERS,
  buildProviderRequest,
  defaultModelForProvider,
  formatSseEvent,
  getProviderErrorMessage,
  providerStreamToClientEvents,
  resolveProvider,
} from "../../lib/openaiChat.mjs";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const provider = resolveProvider({
    provider: Netlify.env.get("AI_PROVIDER"),
    apiKey:
      Netlify.env.get("OPENROUTER_API_KEY") || Netlify.env.get("OPENAI_API_KEY"),
  });
  const apiKey =
    provider === "openrouter"
      ? Netlify.env.get("OPENROUTER_API_KEY") || Netlify.env.get("OPENAI_API_KEY")
      : Netlify.env.get("OPENAI_API_KEY");
  const model =
    provider === "openrouter"
      ? Netlify.env.get("OPENROUTER_MODEL") ||
        Netlify.env.get("OPENAI_MODEL") ||
        Netlify.env.get("AI_MODEL") ||
        defaultModelForProvider(provider)
      : Netlify.env.get("OPENAI_MODEL") ||
        Netlify.env.get("AI_MODEL") ||
        defaultModelForProvider(provider);
  const reasoningEffort =
    provider === "openai" ? Netlify.env.get("OPENAI_REASONING") : undefined;

  if (!apiKey) {
    return json(
      {
        error:
          provider === "openrouter"
            ? "Missing OPENROUTER_API_KEY. Add it to Netlify environment variables and redeploy."
            : "Missing OPENAI_API_KEY. Add it to Netlify environment variables and redeploy.",
      },
      500
    );
  }

  let payload;

  try {
    const body = await req.json();

    payload = buildProviderRequest({
      provider,
      messages: body?.messages,
      model,
      reasoningEffort,
    });
  } catch (error) {
    if (error instanceof ChatInputError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: "Invalid JSON body." }, 400);
  }

  const response = await fetch(PROVIDERS[provider].endpoint, {
    method: "POST",
    headers: requestHeaders(apiKey, provider),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return streamError(await getProviderErrorMessage(response, provider));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const clientEvent of providerStreamToClientEvents(
          response,
          provider
        )) {
          controller.enqueue(
            encoder.encode(formatSseEvent(clientEvent.event, clientEvent.data))
          );
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            formatSseEvent("error", {
              error:
                error instanceof Error
                  ? error.message
                  : "Something went wrong while generating.",
            })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
};

export const config = {
  path: "/api/chat",
  method: ["POST"],
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function streamError(message: string) {
  return new Response(formatSseEvent("error", { error: message }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function requestHeaders(apiKey: string, provider: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://xylir-2-0.netlify.app";
    headers["X-Title"] = "xylir 2.0";
  }

  return headers;
}
