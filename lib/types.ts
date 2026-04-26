export type SuggestionKind =
  | "question"
  | "talking-point"
  | "answer"
  | "fact-check"
  | "clarifier";

export type Suggestion = {
  id: string;
  kind: SuggestionKind;
  title: string;
  preview: string;
  whyNow: string;
};

export type SuggestionBatch = {
  id: string;
  createdAt: string;
  trigger: "auto" | "manual";
  suggestions: Suggestion[];
};

export type TranscriptEntry = {
  id: string;
  text: string;
  createdAt: string;
  startedAt: string;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  source: "chat" | "suggestion-click";
  suggestionId?: string;
};
