import {
  MediaInputError,
  buildPollinationsUrl,
} from "../../lib/pollinationsMedia.mjs";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const prompt = String(body?.prompt || "").trim();
  const kind = String(body?.kind || "image").toLowerCase();
  const model = String(body?.model || "").trim();
  const query = new URLSearchParams({ kind, prompt });

  if (model) {
    query.set("model", model);
  }

  try {
    buildPollinationsUrl({ kind, prompt, model });
  } catch (error) {
    if (error instanceof MediaInputError) {
      return json({ error: error.message }, error.status);
    }

    throw error;
  }

  return json({
    kind,
    prompt,
    url: `/api/media?${query.toString()}`,
  });
};

export const config = {
  path: "/api/generate",
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
