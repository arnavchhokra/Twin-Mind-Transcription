import type { Suggestion, SuggestionBatch } from "@/lib/types";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeWithGroq(apiKey: string, audio: File) {
  const form = new FormData();
  form.append("file", audio);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("language", "en");
  form.append("temperature", "0");

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { text?: string };
}

export async function completeJson<T>({
  apiKey,
  systemPrompt,
  input,
}: {
  apiKey: string;
  systemPrompt: string;
  input: string;
}) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: input,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No content returned from Groq.");
  }

  return JSON.parse(content) as T;
}

export async function streamTextCompletion({
  apiKey,
  systemPrompt,
  messages,
}: {
  apiKey: string;
  systemPrompt: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      stream: true,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messages,
      ],
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = response.body.getReader();

  return new ReadableStream({
    async start(controller) {
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const lines = event.split("\n");
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (!dataLine) {
            continue;
          }

          const payload = dataLine.replace("data: ", "").trim();
          if (payload === "[DONE]") {
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              controller.enqueue(encoder.encode(token));
            }
          } catch {
            continue;
          }
        }
      }

      controller.close();
    },
  });
}

export function sanitizeSuggestions(input: {
  suggestions?: Array<Partial<Suggestion>>;
}) {
  const fallbackKinds: Suggestion["kind"][] = ["question", "answer", "talking-point"];

  return (input.suggestions ?? []).slice(0, 3).map((suggestion, index) => ({
    id: "",
    kind: fallbackKinds[index] ?? "clarifier",
    title: suggestion.title?.trim() || `Suggestion ${index + 1}`,
    preview: suggestion.preview?.trim() || "No preview returned.",
    whyNow: suggestion.whyNow?.trim() || "Relevant to the latest context.",
    ...(suggestion.kind &&
    ["question", "talking-point", "answer", "fact-check", "clarifier"].includes(
      suggestion.kind,
    )
      ? { kind: suggestion.kind as Suggestion["kind"] }
      : {}),
  }));
}

export function flattenSuggestionHistory(history: SuggestionBatch[]) {
  return history.map((batch) => ({
    createdAt: batch.createdAt,
    suggestions: batch.suggestions.map((suggestion) => ({
      kind: suggestion.kind,
      title: suggestion.title,
      preview: suggestion.preview,
    })),
  }));
}
