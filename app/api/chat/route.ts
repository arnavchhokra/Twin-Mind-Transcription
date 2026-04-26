import { NextResponse } from "next/server";
import { streamTextCompletion } from "@/lib/server/groq";
import type { Suggestion } from "@/lib/types";

type ChatRequest = {
  apiKey: string;
  prompt: string;
  transcriptContext: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  question: string;
  suggestion?: Suggestion;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest;

  if (!body.apiKey?.trim() || !body.prompt?.trim() || !body.question?.trim()) {
    return new NextResponse("Missing prompt, question, or API key.", { status: 400 });
  }

  try {
    const stream = await streamTextCompletion({
      apiKey: body.apiKey,
      systemPrompt: body.prompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              transcriptContext: body.transcriptContext,
              clickedSuggestion: body.suggestion
                ? {
                    kind: body.suggestion.kind,
                    title: body.suggestion.title,
                    preview: body.suggestion.preview,
                    whyNow: body.suggestion.whyNow,
                  }
                : null,
              latestQuestion: body.question,
            },
            null,
            2,
          ),
        },
        ...body.conversation,
      ],
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat completion failed.";
    return new NextResponse(message, { status: 500 });
  }
}
