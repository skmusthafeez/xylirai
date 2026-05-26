export const POLLINATIONS_BASE_URL = "https://gen.pollinations.ai";

const mediaConfig = {
  image: {
    path: "image",
    contentType: "image/jpeg",
    defaultModel: "flux",
    params: {
      width: "1024",
      height: "1024",
      enhance: "true",
      nologo: "true",
    },
  },
  video: {
    path: "video",
    contentType: "video/mp4",
    defaultModel: "seedance",
    params: {
      duration: "5",
      aspectRatio: "16:9",
    },
  },
  audio: {
    path: "audio",
    contentType: "audio/mpeg",
    defaultModel: "",
    params: {
      voice: "coral",
      format: "mp3",
    },
  },
  music: {
    path: "audio",
    contentType: "audio/mpeg",
    defaultModel: "elevenmusic",
    params: {
      duration: "30",
      format: "mp3",
    },
  },
};

export class MediaInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "MediaInputError";
    this.status = status;
  }
}

export function normalizeMediaKind(kind) {
  const normalized = String(kind || "").toLowerCase();

  if (normalized === "speech") return "audio";

  return mediaConfig[normalized] ? normalized : "image";
}

export function buildPollinationsUrl({ kind, prompt, model }) {
  const normalizedKind = normalizeMediaKind(kind);
  const config = mediaConfig[normalizedKind];
  const cleanedPrompt = String(prompt || "").trim();

  if (!cleanedPrompt) {
    throw new MediaInputError("Enter a prompt for the media you want to create.");
  }

  if (cleanedPrompt.length > 2000) {
    throw new MediaInputError("Media prompts must be 2000 characters or shorter.");
  }

  const url = new URL(
    `/${config.path}/${encodeURIComponent(cleanedPrompt)}`,
    POLLINATIONS_BASE_URL
  );

  for (const [key, value] of Object.entries(config.params)) {
    url.searchParams.set(key, value);
  }

  const selectedModel = String(model || "").trim() || config.defaultModel;

  if (selectedModel) {
    url.searchParams.set("model", selectedModel);
  }

  return {
    kind: normalizedKind,
    url,
    contentType: config.contentType,
  };
}

export function mediaResponseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  };
}
