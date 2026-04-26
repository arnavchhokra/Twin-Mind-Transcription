import { NextResponse } from "next/server";
import {
  completeJson,
  flattenSuggestionHistory,
  sanitizeSuggestions,
} from "@/lib/server/groq";
import type { SuggestionBatch } from "@/lib/types";

type SuggestionRequest = {
  apiKey: string;
  prompt: string;
  recentTranscript: string;
  suggestionHistory: SuggestionBatch[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as SuggestionRequest;

  if (!body.apiKey?.trim() || !body.prompt?.trim() || !body.recentTranscript?.trim()) {
    return new NextResponse("Missing prompt, transcript, or API key.", { status: 400 });
  }

  try {
    const result = await completeJson<{ suggestions?: Array<Record<string, string>> }>({
      apiKey: body.apiKey,
      systemPrompt: body.prompt,
      input: JSON.stringify(
        {
          recentTranscript: body.recentTranscript,
          recentSuggestionHistory: flattenSuggestionHistory(body.suggestionHistory ?? []),
        },
        null,
        2,
      ),
    });

    const suggestions = sanitizeSuggestions(result);
    if (suggestions.length !== 3) {
      return NextResponse.json({
        suggestions: [
          ...suggestions,
          ...sanitizeSuggestions({
            suggestions: [
              {
                kind: "clarifier",
                title: "Clarify the open point",
                preview:
                  "Ask which decision, metric, or owner matters most right now so the conversation narrows.",
                whyNow: "The model returned fewer than three options.",
              },
              {
                kind: "talking-point",
                title: "Summarize the current takeaway",
                preview:
                  "Offer a concise recap of the direction, risk, and next action to keep the room aligned.",
                whyNow: "Useful default when context is broad.",
              },
            ],
          }),
        ].slice(0, 3),
      });
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Suggestion generation failed.";
    return new NextResponse(message, { status: 500 });
  }
}
