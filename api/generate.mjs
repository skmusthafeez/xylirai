import {
  MediaInputError,
  buildPollinationsUrl,
} from "../lib/pollinationsMedia.mjs";
import { json, readJsonBody } from "./_runtime.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  let body;

  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, { error: "Invalid JSON body." });
    return;
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
      json(res, error.status, { error: error.message });
      return;
    }

    throw error;
  }

  json(res, 200, {
    kind,
    prompt,
    url: `/api/media?${query.toString()}`,
  });
}
