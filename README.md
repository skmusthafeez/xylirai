# xylir 2.0

A ChatGPT-style AI chatbot with a distinct lime/cyan theme, local chat history, streaming responses, and image/file uploads.

## Setup

1. Create `.env` from `.env.example` and add your API key:

   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-5.4-mini
   ```

   For an OpenRouter key, use:

   ```bash
   AI_PROVIDER=openrouter
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   OPENROUTER_MODEL=openai/gpt-4o-mini
   ```

2. Start the app:

   ```bash
   powershell -ExecutionPolicy Bypass -File .\start.ps1
   ```

3. Open [http://localhost:3000](http://localhost:3000).

The model is configurable with `OPENAI_MODEL` for OpenAI or `OPENROUTER_MODEL` for OpenRouter.

## Uploads

The composer supports images, PDFs, text, Markdown, CSV, and JSON files.

- Text-like files (`.txt`, `.md`, `.csv`, `.json`) are sent as extracted text automatically.
- Common code files (`.js`, `.ts`, `.html`, `.css`, `.py`, `.sql`, and similar) are sent as extracted text automatically.
- Images and PDFs are sent as multimodal attachments.
- Attachments are limited to 4 MB total per message.

## In-Chat Code Runner

Assistant responses that include fenced `javascript` or `html` code blocks show a `Run` button.

- Runs directly inside the chat bubble in a sandboxed iframe
- Works well for small games, calculators, clocks, and UI demos

## Media Generation (Pollinations)

Use the mode tabs above the prompt box:

- `Image` for text-to-image
- `Video` for text-to-video
- `Audio` for text-to-speech
- `Music` for text-to-music

Media generation is proxied through `/api/generate` and `/api/media` so `POLLINATIONS_API_KEY` stays server-side.

## Netlify

This project includes `netlify.toml` and Netlify Functions for:

- `/api/health`
- `/api/chat`

Set either `OPENAI_API_KEY` and `OPENAI_MODEL`, or `AI_PROVIDER=openrouter` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, in Netlify environment variables before deploying. Add `POLLINATIONS_API_KEY` for image, video, and audio generation.

## Vercel

This project also includes Vercel API functions under `/api`.

In Vercel Project Settings > Environment Variables, set:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
POLLINATIONS_API_KEY=your_pollinations_api_key_here
```

Then redeploy the project. Do not commit real API keys to GitHub.
