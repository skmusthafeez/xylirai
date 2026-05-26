import {
  MediaInputError,
  buildPollinationsUrl,
  mediaResponseHeaders,
} from "../../lib/pollinationsMedia.mjs";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

export default async (req: Request) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  const requestUrl = new URL(req.url);

  try {
    const { url, contentType } = buildPollinationsUrl({
      kind: requestUrl.searchParams.get("kind"),
      prompt: requestUrl.searchParams.get("prompt"),
      model: requestUrl.searchParams.get("model"),
    });

    const response = await fetchPollinationsMedia(url);

    if (!response.ok || !response.body) {
      const errorMessage = await getMediaErrorMessage(response);
      return json(
        {
          error:
            errorMessage ||
            `Pollinations request failed with status ${response.status}.`,
        },
        response.status || 502
      );
    }

    return new Response(response.body, {
      headers: mediaResponseHeaders(
        response.headers.get("content-type") || contentType
      ),
    });
  } catch (error) {
    if (error instanceof MediaInputError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: "Media generation failed." }, 500);
  }
};

export const config = {
  path: "/api/media",
  method: ["GET"],
};

function pollinationsHeaders() {
  const key = Netlify.env.get("POLLINATIONS_API_KEY");

  return key
    ? {
        Authorization: `Bearer ${key}`,
      }
    : {};
}

async function fetchPollinationsMedia(url: URL) {
  const headers = pollinationsHeaders();
  const hasAuth = Boolean(headers.Authorization);
  let response = await fetch(url, { headers });

  if (hasAuth && response.status === 402) {
    response = await fetch(url);
  }

  return response;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

async function getMediaErrorMessage(response: Response) {
  try {
    const jsonPayload = await response.clone().json();
    if (jsonPayload?.error) return String(jsonPayload.error);
    if (jsonPayload?.message) return String(jsonPayload.message);
  } catch {
    // Ignore and fall back to plain text.
  }

  try {
    const text = (await response.text()).trim();
    return text || "";
  } catch {
    return "";
  }
}
