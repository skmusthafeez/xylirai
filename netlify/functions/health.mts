import {
  defaultModelForProvider,
  resolveProvider,
} from "../../lib/openaiChat.mjs";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

export default async (req: Request) => {
  if (req.method !== "GET") {
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

  return json({
    ready: Boolean(apiKey),
    model,
    provider,
  });
};

export const config = {
  path: "/api/health",
  method: ["GET"],
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
