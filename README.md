# TwinMind Live Suggestions Web App

A three-column meeting copilot built for the prompt-engineering assignment:

- left: live mic transcription
- middle: auto-refreshing batches of 3 useful suggestions
- right: one continuous detailed-answer chat

The app is built with Next.js App Router and serverless API routes, using Groq for every model call:

- transcription: `whisper-large-v3`
- suggestions: `openai/gpt-oss-120b`
- detailed answers / chat: `openai/gpt-oss-120b`

## What it does

- Records microphone audio in the browser with `MediaRecorder`
- Flushes transcript chunks every 30 seconds by default
- Sends each chunk to Groq transcription and appends it to the left panel
- Uses recent transcript context to generate exactly 3 fresh suggestions after each refresh
- Keeps older suggestion batches visible below the newest one
- Lets the user click a suggestion to open a deeper answer in chat
- Supports direct typed chat questions in the same session
- Keeps the session in memory for the current tab
- Exports transcript, suggestion batches, chat history, and timestamps as JSON

## Local setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then:

1. Open `Settings`
2. Paste a Groq API key
3. Start the mic

## Prompt strategy

### Live suggestions

The live suggestion prompt is tuned to optimize for the next 10-30 seconds of the conversation rather than generic summaries.

It explicitly asks for:

- exactly 3 suggestions
- a varied mix across `question`, `talking-point`, `answer`, `fact-check`, and `clarifier`
- useful previews that stand on their own without requiring a click
- avoidance of repeating recent ideas from earlier suggestion batches

The route passes:

- only the recent transcript window
- a short history of recent suggestions

This keeps latency down and pushes the model toward moment-aware outputs instead of broad recap behavior.

### Detailed answers

The expanded-answer prompt assumes the user clicked because they want the fuller version of an already useful suggestion. It focuses on:

- direct answer first
- transcript-specific detail
- short bullets the user could say out loud
- explicit uncertainty handling for fact-check style suggestions

### Chat

The freeform chat prompt reuses the same meeting-copilot voice, but allows the user to ask anything directly. The API sends:

- recent transcript context
- prior chat turns
- the latest user question
- clicked suggestion metadata when the chat started from a suggestion

## Stack choices

- `Next.js` for a fast single-project frontend + serverless API setup
- `App Router` route handlers for Groq proxying
- Plain CSS for a tight, assignment-focused UI without design-system overhead
- Browser `MediaRecorder` for chunked audio capture
- `fetch` streaming for lower-latency detailed answers in the chat panel

## Important tradeoffs

- Audio chunks are appended in browser-sized intervals, not word-by-word streaming. This matches the assignment requirement and keeps the implementation much simpler.
- The app keeps everything in memory for the current tab only. There is no login or backend persistence across reloads.
- The API key lives in local browser storage because the user is expected to paste their own key per the assignment.
- The transcription route currently forces `language=en` for more stable meeting output. If multilingual meetings matter, that should become a setting.

## Deploying

The app is ready for serverless deployment on Vercel or similar platforms because all model calls go through route handlers and there is no persistent backend state.

Typical Vercel flow:

```bash
npm install
npm run build
```

Then import the repo into Vercel and deploy with the default Next.js settings.

## Repo structure

```text
app/
  api/
    chat/route.ts
    suggestions/route.ts
    transcribe/route.ts
  globals.css
  layout.tsx
  page.tsx
components/
  app-shell.tsx
lib/
  default-settings.ts
  types.ts
  server/groq.ts
```
