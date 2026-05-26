export const DEFAULT_MODEL = "gpt-5.4-mini";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const PROVIDERS = {
  openai: {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
  },
  openrouter: {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
  },
};

const ASSISTANT_INSTRUCTIONS =
  "You are a helpful AI assistant. Answer naturally, be clear, and use Markdown when it improves readability. When images or files are attached, inspect them carefully and explain what you used from them. If the user asks for runnable code, mini games, calculators, clocks, or interactive demos, return complete JavaScript or HTML inside fenced code blocks (for example ```javascript or ```html) so it can run directly in chat.";

const MAX_MESSAGES = 40;
const MAX_TEXT_LENGTH = 20000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export class ChatInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ChatInputError";
    this.status = status;
  }
}

export function resolveProvider({ provider, apiKey } = {}) {
  const requested = String(provider || "").toLowerCase();

  if (requested === "openrouter" || requested === "openai") {
    return requested;
  }

  return String(apiKey || "").startsWith("sk-or-") ? "openrouter" : "openai";
}

export function defaultModelForProvider(provider) {
  return provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL;
}

export function buildProviderRequest({
  provider,
  messages,
  model,
  reasoningEffort,
}) {
  return provider === "openrouter"
    ? buildOpenRouterRequest({ messages, model })
    : buildOpenAIRequest({ messages, model, reasoningEffort });
}

export function buildOpenAIRequest({ messages, model, reasoningEffort }) {
  const normalizedMessages = normalizeMessages(messages);

  if (!normalizedMessages.some((message) => message.role === "user")) {
    throw new ChatInputError("Send at least one user message.");
  }

  const payload = {
    model: model || DEFAULT_MODEL,
    instructions: ASSISTANT_INSTRUCTIONS,
    input: normalizedMessages,
    stream: true,
  };

  if (reasoningEffort) {
    payload.reasoning = { effort: reasoningEffort };
  }

  return payload;
}

export function buildOpenRouterRequest({ messages, model }) {
  const normalizedMessages = normalizeMessages(messages);

  if (!normalizedMessages.some((message) => message.role === "user")) {
    throw new ChatInputError("Send at least one user message.");
  }

  const payload = {
    model: normalizeOpenRouterModel(model || DEFAULT_OPENROUTER_MODEL),
    messages: [
      {
        role: "system",
        content: ASSISTANT_INSTRUCTIONS,
      },
      ...normalizedMessages.map(toOpenRouterMessage),
    ],
    stream: true,
  };

  if (hasPdfAttachment(normalizedMessages)) {
    payload.plugins = [
      {
        id: "file-parser",
        pdf: {
          engine: "cloudflare-ai",
        },
      },
    ];
  }

  return payload;
}

export function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => ["user", "assistant"].includes(message?.role))
    .map((message) => {
      if (message.role === "user" && Array.isArray(message.content)) {
        return {
          role: "user",
          content: normalizeUserContentItems(message.content),
        };
      }

      return {
        role: message.role,
        content: normalizeText(message.content),
      };
    })
    .filter((message) =>
      Array.isArray(message.content)
        ? message.content.length > 0
        : message.content.trim().length > 0
    )
    .slice(-MAX_MESSAGES);
}

export async function getOpenAIErrorMessage(response) {
  try {
    const payload = await response.json();
    return (
      payload?.error?.message ||
      payload?.message ||
      `OpenAI request failed with status ${response.status}.`
    );
  } catch {
    return `OpenAI request failed with status ${response.status}.`;
  }
}

export async function getProviderErrorMessage(response, provider = "openai") {
  try {
    const payload = await response.json();
    return (
      payload?.error?.message ||
      payload?.message ||
      `${PROVIDERS[provider]?.label || "AI"} request failed with status ${
        response.status
      }.`
    );
  } catch {
    return `${PROVIDERS[provider]?.label || "AI"} request failed with status ${
      response.status
    }.`;
  }
}

export async function* openAIStreamToClientEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal?.aborted) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const event = parseOpenAIEvent(chunk);
      if (!event?.data || event.data === "[DONE]") continue;

      const payload = JSON.parse(event.data);
      const clientEvent = toClientEvent(payload, response.model);

      if (clientEvent) {
        yield clientEvent;
      }
    }
  }
}

export async function* providerStreamToClientEvents(
  response,
  provider,
  signal
) {
  if (provider === "openrouter") {
    yield* openRouterStreamToClientEvents(response, signal);
    return;
  }

  yield* openAIStreamToClientEvents(response, signal);
}

export async function* openRouterStreamToClientEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneSent = false;

  while (!signal?.aborted) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const event = parseOpenAIEvent(chunk);
      if (!event?.data) continue;

      if (event.data === "[DONE]") {
        doneSent = true;
        yield { event: "done", data: { id: null, model: null } };
        continue;
      }

      const payload = JSON.parse(event.data);
      const delta = payload.choices?.[0]?.delta?.content;

      if (typeof delta === "string" && delta) {
        yield { event: "delta", data: { text: delta } };
      }

      if (payload.error) {
        yield {
          event: "error",
          data: {
            error:
              payload.error?.message ||
              "The model could not complete the response.",
          },
        };
      }
    }
  }

  if (!doneSent) {
    yield { event: "done", data: { id: null, model: null } };
  }
}

export function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function normalizeUserContentItems(items) {
  let attachmentCount = 0;

  return items
    .map((item) => {
      if (item?.type === "input_text") {
        const text = normalizeText(item.text);
        return text ? { type: "input_text", text } : null;
      }

      if (item?.type === "input_image") {
        attachmentCount += 1;
        assertAttachmentCount(attachmentCount);
        const imageUrl = String(item.image_url || "");
        validateDataUrl(imageUrl, "image/");
        return {
          type: "input_image",
          image_url: imageUrl,
        };
      }

      if (item?.type === "input_file") {
        attachmentCount += 1;
        assertAttachmentCount(attachmentCount);
        const fileData = String(item.file_data || "");
        validateDataUrl(fileData);
        return {
          type: "input_file",
          filename: sanitizeFilename(item.filename || "attachment"),
          file_data: fileData,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function toOpenRouterMessage(message) {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return {
      role: message.role,
      content: typeof message.content === "string" ? message.content : "",
    };
  }

  return {
    role: "user",
    content: message.content.map(toOpenRouterContentPart).filter(Boolean),
  };
}

function toOpenRouterContentPart(part) {
  if (part.type === "input_text") {
    return {
      type: "text",
      text: part.text,
    };
  }

  if (part.type === "input_image") {
    return {
      type: "image_url",
      image_url: {
        url: part.image_url,
      },
    };
  }

  if (part.type === "input_file") {
    return {
      type: "file",
      file: {
        filename: part.filename,
        file_data: part.file_data,
      },
    };
  }

  return null;
}

function hasPdfAttachment(messages) {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          part.type === "input_file" &&
          part.file_data.toLowerCase().startsWith("data:application/pdf;")
      )
  );
}

function normalizeOpenRouterModel(model) {
  if (!model) return DEFAULT_OPENROUTER_MODEL;
  if (model.includes("/")) return model;
  if (model.startsWith("gpt-")) return `openai/${model}`;
  return model;
}

function normalizeText(value) {
  return String(value || "").slice(0, MAX_TEXT_LENGTH).trim();
}

function assertAttachmentCount(count) {
  if (count > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new ChatInputError(
      `You can send up to ${MAX_ATTACHMENTS_PER_MESSAGE} attachments at once.`
    );
  }
}

function validateDataUrl(dataUrl, requiredMimePrefix = "") {
  if (!dataUrl.startsWith("data:") || !dataUrl.includes(";base64,")) {
    throw new ChatInputError("Attachment data must be a base64 data URL.");
  }

  const mime = dataUrl.slice(5, dataUrl.indexOf(";base64,")).toLowerCase();

  if (requiredMimePrefix && !mime.startsWith(requiredMimePrefix)) {
    throw new ChatInputError("This attachment type is not supported here.");
  }

  if (estimatedBase64Bytes(dataUrl) > MAX_FILE_BYTES) {
    throw new ChatInputError("Each attachment must be 4 MB or smaller.");
  }
}

function estimatedBase64Bytes(dataUrl) {
  const base64 = dataUrl.split(";base64,")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function sanitizeFilename(name) {
  const clean = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return clean.slice(0, 120) || "attachment";
}

function parseOpenAIEvent(chunk) {
  const lines = chunk.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace("data:", "").trim());

  return {
    event: eventLine?.replace("event:", "").trim() || "message",
    data: dataLines.join("\n"),
  };
}

function toClientEvent(payload, fallbackModel) {
  if (payload.type === "response.output_text.delta" && payload.delta) {
    return { event: "delta", data: { text: payload.delta } };
  }

  if (payload.type === "response.completed") {
    return {
      event: "done",
      data: {
        id: payload.response?.id ?? null,
        model: payload.response?.model ?? fallbackModel ?? null,
      },
    };
  }

  if (payload.type === "response.failed" || payload.type === "error") {
    return {
      event: "error",
      data: {
        error:
          payload.response?.error?.message ||
          payload.error?.message ||
          "The model could not complete the response.",
      },
    };
  }

  return null;
}
