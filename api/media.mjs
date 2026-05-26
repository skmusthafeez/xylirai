import {
  MediaInputError,
  buildPollinationsUrl,
  mediaResponseHeaders,
} from "../lib/pollinationsMedia.mjs";
import { json } from "./_runtime.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const requestUrl = new URL(req.url || "/", "https://xylirai.vercel.app");

  try {
    const { url, contentType } = buildPollinationsUrl({
      kind: requestUrl.searchParams.get("kind"),
      prompt: requestUrl.searchParams.get("prompt"),
      model: requestUrl.searchParams.get("model"),
    });

    const response = await fetchPollinationsMedia(url);

    if (!response.ok || !response.body) {
      json(res, response.status || 502, {
        error:
          (await getMediaErrorMessage(response)) ||
          `Pollinations request failed with status ${response.status}.`,
      });
      return;
    }

    res.writeHead(
      200,
      mediaResponseHeaders(response.headers.get("content-type") || contentType)
    );

    for await (const chunk of response.body) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    if (error instanceof MediaInputError) {
      json(res, error.status, { error: error.message });
      return;
    }

    json(res, 500, { error: "Media generation failed." });
  }
}

function pollinationsHeaders() {
  return process.env.POLLINATIONS_API_KEY
    ? {
        Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`,
      }
    : {};
}

async function fetchPollinationsMedia(url) {
  const headers = pollinationsHeaders();
  const hasAuth = Boolean(headers.Authorization);
  let response = await fetch(url, { headers });

  if (hasAuth && response.status === 402) {
    response = await fetch(url);
  }

  return response;
}

async function getMediaErrorMessage(response) {
  try {
    const payload = await response.clone().json();
    if (payload?.error) return String(payload.error);
    if (payload?.message) return String(payload.message);
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
