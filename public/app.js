const STORAGE_KEY = "xylir-2.0.conversations.v1";
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const supportedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/xml",
  "text/xml",
]);

const supportedExtensions = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "pdf",
  "js",
  "ts",
  "jsx",
  "tsx",
  "html",
  "css",
  "xml",
  "yaml",
  "yml",
  "log",
  "py",
  "java",
  "c",
  "cpp",
  "cs",
  "go",
  "rs",
  "php",
  "rb",
  "sql",
]);
const RUNNABLE_LANGUAGES = new Set(["javascript", "js", "html", "htm"]);
const runnableCodeBlocks = new Map();

const elements = {
  sidebar: document.querySelector("#sidebar"),
  menuButton: document.querySelector("#menuButton"),
  newChatButton: document.querySelector("#newChatButton"),
  clearButton: document.querySelector("#clearButton"),
  historyList: document.querySelector("#historyList"),
  searchInput: document.querySelector("#searchInput"),
  chatTitle: document.querySelector("#chatTitle"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#messageInput"),
  fileInput: document.querySelector("#fileInput"),
  attachmentStrip: document.querySelector("#attachmentStrip"),
  modeTabs: document.querySelector("#modeTabs"),
  composerNotice: document.querySelector("#composerNotice"),
  sendButton: document.querySelector("#sendButton"),
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
};

const prompts = [
  {
    mode: "image",
    title: "Image",
    text: "A cinematic night city skyline in rain, reflections on glass, ultra detailed",
  },
  {
    mode: "video",
    title: "Video",
    text: "A slow drone flyover above a tropical island at sunrise, cinematic, 5 seconds",
  },
  {
    mode: "audio",
    title: "Audio",
    text: "A warm voice saying: Welcome to xylir 2.0. Your project assistant is ready.",
  },
  {
    mode: "music",
    title: "Music",
    text: "A 30 second upbeat synthwave loop with bright arpeggios and a clean drum groove",
  },
  {
    mode: "all",
    title: "Chat + Files",
    text: "Summarize the attached file and list action items",
  },
];

const state = {
  conversations: loadConversations(),
  activeId: null,
  streaming: false,
  abortController: null,
  pendingAttachments: [],
  mode: "all",
};

state.activeId = state.conversations[0]?.id || createConversation().id;

render();
checkHealth();
wireEvents();
syncIcons();

function wireEvents() {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.streaming) {
      stopGeneration();
      return;
    }
    sendCurrentMessage();
  });

  elements.input.addEventListener("input", () => {
    resizeTextarea();
    updateSendButton();
  });

  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.fileInput.addEventListener("change", async () => {
    await addFiles([...elements.fileInput.files]);
    elements.fileInput.value = "";
  });

  elements.modeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    setMode(button.dataset.mode);
  });

  elements.attachmentStrip.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-attachment]");
    if (!button) return;
    state.pendingAttachments = state.pendingAttachments.filter(
      (attachment) => attachment.id !== button.dataset.removeAttachment
    );
    renderPendingAttachments();
    updateSendButton();
  });

  elements.form.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.form.classList.add("dragging");
  });

  elements.form.addEventListener("dragleave", (event) => {
    if (!elements.form.contains(event.relatedTarget)) {
      elements.form.classList.remove("dragging");
    }
  });

  elements.form.addEventListener("drop", async (event) => {
    event.preventDefault();
    elements.form.classList.remove("dragging");
    await addFiles([...event.dataTransfer.files]);
  });

  elements.newChatButton.addEventListener("click", () => {
    const conversation = createConversation();
    state.activeId = conversation.id;
    state.pendingAttachments = [];
    saveConversations();
    render();
    elements.input.focus();
    elements.sidebar.classList.remove("open");
  });

  elements.clearButton.addEventListener("click", () => {
    if (!state.conversations.length) return;
    state.conversations = [];
    state.activeId = createConversation().id;
    state.pendingAttachments = [];
    saveConversations();
    render();
  });

  elements.searchInput.addEventListener("input", renderHistory);

  elements.menuButton.addEventListener("click", () => {
    elements.sidebar.classList.toggle("open");
  });

  elements.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button) return;
    state.activeId = button.dataset.conversationId;
    render();
    elements.sidebar.classList.remove("open");
  });

  elements.messages.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy]");
    const promptButton = event.target.closest("[data-prompt]");
    const runCodeButton = event.target.closest("[data-run-code]");

    if (promptButton) {
      elements.input.value = promptButton.dataset.prompt;
      setMode(promptButton.dataset.mode || "all");
      resizeTextarea();
      updateSendButton();
      elements.input.focus();
      return;
    }

    if (runCodeButton) {
      runCodeInChat(runCodeButton);
      return;
    }

    if (!copyButton) return;

    const message = activeConversation().messages.find(
      (item) => item.id === copyButton.dataset.copy
    );

    if (message?.content) {
      await navigator.clipboard.writeText(message.content);
      copyButton.classList.add("copied");
      setTimeout(() => copyButton.classList.remove("copied"), 900);
    }
  });
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    elements.statusPill.classList.toggle("ready", health.ready);
    elements.statusPill.classList.toggle("error", !health.ready);
    elements.statusText.textContent = health.ready ? "Ready" : "Setup";
  } catch {
    elements.statusPill.classList.add("error");
    elements.statusText.textContent = "Offline";
  }
}

async function addFiles(files) {
  clearComposerNotice();

  if (!files.length) return;

  const slots = MAX_ATTACHMENTS - state.pendingAttachments.length;

  if (slots <= 0) {
    setComposerNotice(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
    return;
  }

  const selected = files.slice(0, slots);

  if (files.length > slots) {
    setComposerNotice(`Only ${MAX_ATTACHMENTS} attachments can be sent at once.`);
  }

  for (const file of selected) {
    try {
      validateFile(file);
      const currentTotal = state.pendingAttachments.reduce(
        (total, attachment) => total + attachment.size,
        0
      );

      if (currentTotal + file.size > MAX_TOTAL_BYTES) {
        throw new Error("Attachments must total 4 MB or less per message.");
      }

      state.pendingAttachments.push(await readAttachment(file));
    } catch (error) {
      setComposerNotice(error.message);
    }
  }

  renderPendingAttachments();
  updateSendButton();
}

async function sendCurrentMessage() {
  const content = elements.input.value.trim();
  const attachments = state.pendingAttachments;

  if (state.streaming) return;

  if (isMediaMode(state.mode)) {
    if (attachments.length) {
      setComposerNotice("Switch to Chat to send files and images.");
      return;
    }

    if (!content) {
      setComposerNotice("Enter a prompt to generate media.");
      return;
    }

    state.pendingAttachments = [];
    renderPendingAttachments();
    await sendMediaMessage(content);
    return;
  }

  if (!content && !attachments.length) return;

  const conversation = activeConversation();
  conversation.messages.push(createMessage("user", content, attachments));
  conversation.title = titleFromMessage(content, attachments);
  conversation.updatedAt = Date.now();

  const assistantMessage = createMessage("assistant", "");
  conversation.messages.push(assistantMessage);

  elements.input.value = "";
  state.pendingAttachments = [];
  clearComposerNotice();
  renderPendingAttachments();
  resizeTextarea();
  setStreaming(true);
  saveConversations();
  render();

  state.abortController = new AbortController();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages
          .filter((message) => message.id !== assistantMessage.id)
          .map(toApiMessage),
      }),
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload.error || "The chat request failed.");
    }

    await readEventStream(response, {
      delta(text) {
        assistantMessage.content += text;
        conversation.updatedAt = Date.now();
        updateAssistantMessage(assistantMessage);
      },
      error(message) {
        throw new Error(message);
      },
    });

    if (!assistantMessage.content.trim()) {
      assistantMessage.content =
        "I did not receive any text back. Try sending that once more.";
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      assistantMessage.content = `Error: ${error.message}`;
      updateAssistantMessage(assistantMessage);
    }
  } finally {
    setStreaming(false);
    state.abortController = null;
    conversation.updatedAt = Date.now();
    saveConversations();
    renderHistory();
    updateAssistantMessage(assistantMessage);
  }
}

async function sendMediaMessage(prompt) {
  const kind = state.mode;
  const conversation = activeConversation();
  conversation.messages.push(createMessage("user", prompt));
  conversation.title = `${modeTitle(kind)}: ${titleFromMessage(prompt)}`;
  conversation.updatedAt = Date.now();

  const assistantMessage = createMessage(
    "assistant",
    `Creating ${modeTitle(kind).toLowerCase()}...`
  );
  conversation.messages.push(assistantMessage);

  elements.input.value = "";
  clearComposerNotice();
  resizeTextarea();
  setStreaming(true);
  saveConversations();
  render();

  state.abortController = new AbortController();

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, prompt }),
      signal: state.abortController.signal,
    });

    const payload = await safeJson(response);

    if (!response.ok) {
      throw new Error(payload.error || "The media request failed.");
    }

    assistantMessage.content = `${modeTitle(kind)} generated from your prompt.`;
    assistantMessage.media = {
      kind: payload.kind,
      url: payload.url,
      prompt,
    };
    updateAssistantMessage(assistantMessage);
  } catch (error) {
    if (error.name !== "AbortError") {
      assistantMessage.content = `Error: ${error.message}`;
      updateAssistantMessage(assistantMessage);
    }
  } finally {
    setStreaming(false);
    state.abortController = null;
    conversation.updatedAt = Date.now();
    saveConversations();
    renderHistory();
    updateAssistantMessage(assistantMessage);
  }
}

function stopGeneration() {
  state.abortController?.abort();
  setStreaming(false);
}

async function readEventStream(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const parsed = parseServerEvent(chunk);

      if (parsed.event === "delta") {
        handlers.delta(parsed.data.text || "");
      }

      if (parsed.event === "error") {
        handlers.error(parsed.data.error || "The model returned an error.");
      }
    }
  }
}

function parseServerEvent(chunk) {
  const lines = chunk.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));

  return {
    event: eventLine?.replace("event:", "").trim() || "message",
    data: dataLine ? JSON.parse(dataLine.replace("data:", "").trim()) : {},
  };
}

function setStreaming(isStreaming) {
  state.streaming = isStreaming;
  elements.input.disabled = isStreaming;
  elements.fileInput.disabled = isStreaming;
  elements.sendButton.classList.toggle("stop", isStreaming);
  elements.sendButton.setAttribute(
    "aria-label",
    isStreaming ? "Stop generating" : "Send message"
  );
  elements.sendButton.setAttribute("title", isStreaming ? "Stop" : "Send");
  elements.sendButton.innerHTML = isStreaming
    ? '<i data-lucide="square" data-fallback="[]" aria-hidden="true"></i>'
    : '<i data-lucide="arrow-up" data-fallback="^" aria-hidden="true"></i>';
  updateSendButton();
  syncIcons();
}

function updateSendButton() {
  elements.sendButton.disabled =
    !state.streaming &&
    !elements.input.value.trim() &&
    state.pendingAttachments.length === 0;
}

function updateAssistantMessage(message) {
  const bubble = document.querySelector(`[data-message-body="${message.id}"]`);
  if (!bubble) {
    renderMessages();
    return;
  }

  bubble.innerHTML = message.content
    ? `${renderMessageMedia(message.media)}${renderMarkdown(message.content)}`
    : renderTyping();
  elements.messages.scrollTop = elements.messages.scrollHeight;
  syncIcons();
}

function render() {
  renderHistory();
  renderMessages();
  renderPendingAttachments();
  renderModeTabs();
  updateHeading();
  updateInputPlaceholder();
  updateSendButton();
  resizeTextarea();
  syncIcons();
}

function renderHistory() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const conversations = state.conversations
    .filter((conversation) => conversation.title.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  elements.historyList.innerHTML = conversations
    .map(
      (conversation) => `
        <button class="history-item ${conversation.id === state.activeId ? "active" : ""}"
          type="button"
          data-conversation-id="${conversation.id}">
          <span class="history-title">${escapeHtml(conversation.title)}</span>
          <span class="history-date">${formatDate(conversation.updatedAt)}</span>
        </button>
      `
    )
    .join("");
}

function renderMessages() {
  const conversation = activeConversation();
  runnableCodeBlocks.clear();

  if (!conversation.messages.length) {
    elements.messages.innerHTML = `
      <div class="empty-state">
        <div>
          <span class="eyebrow">xylir 2.0</span>
          <h2>How can I help you today?</h2>
        </div>
        <p>Ask anything, upload files and images, or switch modes to generate image, video, audio, or music from text prompts.</p>
        <div class="prompt-grid">
          ${prompts
            .map(
              (prompt) => `
                <button class="prompt-chip" type="button" data-prompt="${escapeAttribute(
                  prompt.text
                )}" data-mode="${prompt.mode}">
                  <span>${escapeHtml(prompt.title)}</span>
                  <strong>${escapeHtml(prompt.text)}</strong>
                </button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
    return;
  }

  elements.messages.innerHTML = conversation.messages
    .map((message) => {
      const isUser = message.role === "user";
      const name = isUser ? "You" : "xylir 2.0";
      const avatar = isUser ? "Y" : "X";
      const body = message.content ? renderMarkdown(message.content) : "";
      const attachments = renderMessageAttachments(message.attachments || []);
      const media = renderMessageMedia(message.media);
      const copy = isUser
        ? ""
        : `<button class="copy-button" type="button" data-copy="${message.id}" aria-label="Copy response" title="Copy">
            <i data-lucide="copy" data-fallback="C" aria-hidden="true"></i>
          </button>`;

      return `
        <article class="message-row ${message.role}">
          <div class="avatar" aria-hidden="true">${avatar}</div>
          <div class="message">
            <div class="message-header">
              <span>${name}</span>
              ${copy}
            </div>
            <div class="bubble" data-message-body="${message.id}">
              ${attachments}
              ${media}
              ${body || (!message.content && !attachments ? renderTyping() : "")}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderModeTabs() {
  elements.modeTabs.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
}

function renderPendingAttachments() {
  if (!state.pendingAttachments.length) {
    elements.attachmentStrip.hidden = true;
    elements.attachmentStrip.innerHTML = "";
    return;
  }

  elements.attachmentStrip.hidden = false;
  elements.attachmentStrip.innerHTML = state.pendingAttachments
    .map(
      (attachment) => `
        <div class="pending-attachment">
          ${
            attachment.kind === "image"
              ? `<img src="${attachment.dataUrl}" alt="" />`
              : `<span class="file-icon">${fileInitial(attachment.name)}</span>`
          }
          <span class="pending-meta">
            <strong>${escapeHtml(attachment.name)}</strong>
            <small>${formatBytes(attachment.size)}</small>
          </span>
          <button type="button" data-remove-attachment="${attachment.id}" aria-label="Remove ${escapeAttribute(
            attachment.name
          )}" title="Remove">
            <i data-lucide="x" data-fallback="x" aria-hidden="true"></i>
          </button>
        </div>
      `
    )
    .join("");
  syncIcons();
}

function renderMessageAttachments(attachments) {
  if (!attachments.length) return "";

  return `
    <div class="message-attachments">
      ${attachments
        .map((attachment) => {
          if (attachment.kind === "image" && attachment.dataUrl) {
            return `
              <figure class="message-image">
                <img src="${attachment.dataUrl}" alt="${escapeAttribute(attachment.name)}" />
                <figcaption>${escapeHtml(attachment.name)}</figcaption>
              </figure>
            `;
          }

          return `
            <div class="message-file">
              <span class="file-icon">${fileInitial(attachment.name)}</span>
              <span>
                <strong>${escapeHtml(attachment.name)}</strong>
                <small>${formatBytes(attachment.size)}</small>
              </span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMessageMedia(media) {
  if (!media?.url) return "";

  const prompt = escapeAttribute(media.prompt || "Generated media");

  if (media.kind === "video") {
    return `
      <figure class="generated-media">
        <video controls playsinline preload="metadata" src="${escapeAttribute(media.url)}"></video>
        <figcaption>${prompt}</figcaption>
      </figure>
    `;
  }

  if (media.kind === "audio" || media.kind === "music") {
    return `
      <figure class="generated-media audio-media">
        <audio controls src="${escapeAttribute(media.url)}"></audio>
        <figcaption>${prompt}</figcaption>
      </figure>
    `;
  }

  return `
    <figure class="generated-media">
      <img src="${escapeAttribute(media.url)}" alt="${prompt}" />
      <figcaption>${prompt}</figcaption>
    </figure>
  `;
}

function updateHeading() {
  elements.chatTitle.textContent = activeConversation().title;
}

function resizeTextarea() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 210)}px`;
}

function createConversation() {
  const conversation = {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now(),
  };

  state.conversations.unshift(conversation);
  return conversation;
}

function createMessage(role, content, attachments = [], media = null) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    attachments,
    media,
    createdAt: Date.now(),
  };
}

function toApiMessage(message) {
  if (message.role !== "user") {
    return {
      role: message.role,
      content: message.content,
    };
  }

  const content = [];
  const text = message.content?.trim();

  if (text) {
    content.push({ type: "input_text", text });
  } else if (message.attachments?.length) {
    content.push({
      type: "input_text",
      text: "Please inspect the attached file or image.",
    });
  }

  for (const attachment of message.attachments || []) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      content.push({
        type: "input_image",
        image_url: attachment.dataUrl,
      });
      continue;
    }

    if (attachment.kind === "file" && attachment.textContent) {
      const maxChars = 16000;
      const body = attachment.textContent.slice(0, maxChars);
      const suffix =
        attachment.textContent.length > maxChars
          ? "\n\n[File content truncated for size.]"
          : "";

      content.push({
        type: "input_text",
        text: `Attached file: ${attachment.name}\n\n${body}${suffix}`,
      });
      continue;
    }

    if (attachment.kind === "file" && attachment.dataUrl) {
      content.push({
        type: "input_file",
        filename: attachment.name,
        file_data: attachment.dataUrl,
      });
    }
  }

  return {
    role: "user",
    content,
  };
}

function setMode(mode) {
  state.mode = mode || "all";
  renderModeTabs();
  updateInputPlaceholder();
  updateSendButton();
}

function modeTitle(mode) {
  const titles = {
    all: "Chat",
    image: "Image",
    video: "Video",
    audio: "Audio",
    music: "Music",
  };

  return titles[mode] || "Chat";
}

function isMediaMode(mode) {
  return ["image", "video", "audio", "music"].includes(mode);
}

function updateInputPlaceholder() {
  const placeholders = {
    all: "Message xylir 2.0 or attach files/images",
    image: "Describe the image you want to generate",
    video: "Describe the video you want to generate",
    audio: "Describe the audio/voice you want to generate",
    music: "Describe the music you want to generate",
  };

  elements.input.placeholder = placeholders[state.mode] || placeholders.all;
}

function activeConversation() {
  return state.conversations.find((item) => item.id === state.activeId);
}

function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeConversations()));
  } catch {
    setComposerNotice("Chat history is full, but this conversation can continue.");
  }
}

function serializeConversations() {
  return state.conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: (message.attachments || []).map((attachment) => ({
        ...attachment,
        dataUrl: "",
        textContent: "",
      })),
    })),
  }));
}

function loadConversations() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function titleFromMessage(message, attachments = []) {
  const cleaned = message.replace(/\s+/g, " ").trim();

  if (cleaned) {
    return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
  }

  if (attachments.length === 1) {
    return `Uploaded ${attachments[0].name}`;
  }

  if (attachments.length > 1) {
    return `Uploaded ${attachments.length} files`;
  }

  return "New chat";
}

async function readAttachment(file) {
  const dataUrl = await fileToDataUrl(file);
  const textContent = await readTextContent(file);
  return {
    id: crypto.randomUUID(),
    name: file.name || "attachment",
    type: file.type || fallbackMimeType(file.name),
    size: file.size,
    kind: isImageFile(file) ? "image" : "file",
    dataUrl,
    textContent,
  };
}

function validateFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 4 MB.`);
  }

  if (!isSupportedFile(file)) {
    throw new Error(`${file.name} is not a supported file type.`);
  }
}

function isSupportedFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return supportedTypes.has(file.type) || supportedExtensions.has(extension);
}

function isImageFile(fileOrAttachment) {
  return String(fileOrAttachment.type || "").startsWith("image/");
}

function fallbackMimeType(name) {
  const extension = name.split(".").pop()?.toLowerCase();

  if (extension === "md") return "text/markdown";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "pdf") return "application/pdf";
  if (extension === "html") return "text/html";
  if (extension === "css") return "text/css";
  if (["js", "jsx", "ts", "tsx"].includes(extension)) return "text/javascript";
  if (["xml", "yaml", "yml", "log", "py", "java", "c", "cpp", "cs", "go", "rs", "php", "rb", "sql"].includes(extension)) return "text/plain";
  return "text/plain";
}

async function readTextContent(file) {
  if (isImageFile(file) || !isTextLikeFile(file)) {
    return "";
  }

  try {
    return await file.text();
  } catch {
    return "";
  }
}

function isTextLikeFile(file) {
  const type = String(file.type || "").toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (type.startsWith("text/")) return true;
  if (type === "application/json") return true;
  if (type === "application/javascript") return true;
  if (type === "application/xml") return true;
  return [
    "txt",
    "md",
    "csv",
    "json",
    "js",
    "ts",
    "jsx",
    "tsx",
    "html",
    "css",
    "xml",
    "yaml",
    "yml",
    "log",
    "py",
    "java",
    "c",
    "cpp",
    "cs",
    "go",
    "rs",
    "php",
    "rb",
    "sql",
  ].includes(extension);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function setComposerNotice(message) {
  elements.composerNotice.textContent = message;
  elements.composerNotice.classList.add("visible");
}

function clearComposerNotice() {
  elements.composerNotice.textContent = "";
  elements.composerNotice.classList.remove("visible");
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 2);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function fileInitial(name) {
  const extension = name.split(".").pop()?.slice(0, 3).toUpperCase();
  return escapeHtml(extension || "FILE");
}

function renderTyping() {
  return '<span class="typing" aria-label="Generating"><span></span><span></span><span></span></span>';
}

function renderMarkdown(markdown) {
  const blocks = [];
  const raw = String(markdown || "");
  const withTokens = raw.replace(
    /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
    (_match, rawLanguage, rawCode) => {
      const token = `@@CODE${blocks.length}@@`;
      const language = normalizeCodeLanguage(rawLanguage);
      const code = String(rawCode || "").replace(/^\n+|\n+$/g, "");
      const showRunButton = isRunnableLanguage(language);

      let runButton = "";
      if (showRunButton) {
        const codeId = crypto.randomUUID();
        runnableCodeBlocks.set(codeId, { language, code });
        runButton = `
          <button class="run-code-button" type="button" data-run-code="${codeId}" aria-label="Run code" title="Run code">
            <i data-lucide="play" data-fallback=">" aria-hidden="true"></i>
            <span>Run</span>
          </button>
        `;
      }

      blocks.push(`
        <div class="code-block">
          <div class="code-toolbar">
            <span class="code-language">${escapeHtml(language || "code")}</span>
            ${runButton}
          </div>
          <pre><code>${escapeHtml(code)}</code></pre>
          <div class="code-runner-shell" hidden></div>
        </div>
      `);

      return token;
    }
  );
  let safe = escapeHtml(withTokens);

  safe = safe
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );

  safe = safe
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("@@CODE")) return block;
      if (/^[-*] /m.test(block)) {
        return `<ul>${block
          .split("\n")
          .filter(Boolean)
          .map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${block.replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  blocks.forEach((block, index) => {
    safe = safe.replace(`@@CODE${index}@@`, block);
  });

  return safe;
}

function normalizeCodeLanguage(language) {
  const normalized = String(language || "").toLowerCase().trim();

  if (normalized === "js") return "javascript";
  if (normalized === "htm") return "html";

  return normalized;
}

function isRunnableLanguage(language) {
  return RUNNABLE_LANGUAGES.has(String(language || "").toLowerCase());
}

function runCodeInChat(button) {
  const codeId = button.dataset.runCode;
  const snippet = runnableCodeBlocks.get(codeId);

  if (!snippet) {
    setComposerNotice("This code snippet is no longer available. Regenerate the response and try again.");
    return;
  }

  const codeBlock = button.closest(".code-block");
  const shell = codeBlock?.querySelector(".code-runner-shell");
  if (!codeBlock || !shell) return;

  shell.hidden = false;
  shell.innerHTML = "";

  const frame = document.createElement("iframe");
  frame.className = "code-runner-frame";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("loading", "lazy");
  frame.srcdoc = buildRunnerDocument(snippet.language, snippet.code);
  shell.append(frame);

  button.classList.add("ran");
  button.title = "Run again";
  syncIcons();
}

function buildRunnerDocument(language, code) {
  if (language === "html" || looksLikeHtml(code)) {
    const html = String(code || "");
    if (/<(html|body|head|script|style)\b/i.test(html)) {
      return html;
    }

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; padding: 12px; font-family: Inter, system-ui, sans-serif; color: #f4f7ed; background: #10110f; }
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`;
  }

  return buildJavaScriptRunnerDocument(code);
}

function looksLikeHtml(code) {
  const text = String(code || "").trim();
  if (!text.startsWith("<")) return false;
  return /<(html|body|div|section|main|canvas|script|style|h1|h2|h3|p|button|input)\b/i.test(
    text
  );
}

function buildJavaScriptRunnerDocument(code) {
  const source = JSON.stringify(String(code || ""));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #10110f; color: #f4f7ed; font-family: Inter, system-ui, sans-serif; }
      #app { min-height: 100vh; padding: 12px; }
      #console { margin: 0; padding: 12px; border-top: 1px solid rgba(255,255,255,0.12); white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: #dfe7d5; background: #0b0c0a; }
      #console:empty { display: none; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <pre id="console"></pre>
    <script>
      const app = document.getElementById("app");
      const consoleEl = document.getElementById("console");

      function writeLine(value) {
        consoleEl.textContent += value + "\\n";
      }

      function formatArg(arg) {
        if (typeof arg === "string") return arg;
        try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
      }

      console.log = (...args) => writeLine(args.map(formatArg).join(" "));
      console.error = (...args) => writeLine("Error: " + args.map(formatArg).join(" "));
      console.warn = (...args) => writeLine("Warning: " + args.map(formatArg).join(" "));

      window.addEventListener("error", (event) => {
        writeLine("Error: " + (event.message || "Unknown runtime error"));
      });

      window.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason?.message || String(event?.reason || "Promise rejected");
        writeLine("Unhandled rejection: " + reason);
      });

      (async () => {
        try {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const run = new AsyncFunction("app", ${source});
          const result = await run(app);
          if (typeof result !== "undefined") {
            writeLine("Result: " + formatArg(result));
          }
        } catch (error) {
          writeLine("Error: " + (error?.message || String(error)));
        }
      })();
    <\/script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function syncIcons() {
  window.lucide?.createIcons();
}
