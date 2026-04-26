"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/default-settings";
import type {
  ChatMessage,
  Suggestion,
  SuggestionBatch,
  SuggestionKind,
  TranscriptEntry,
} from "@/lib/types";

type RecorderState = "idle" | "requesting" | "recording" | "stopping";

type SessionBundle = {
  transcript: TranscriptEntry[];
  suggestionBatches: SuggestionBatch[];
  chatHistory: ChatMessage[];
  exportedAt: string;
  settings: {
    transcriptChunkSeconds: number;
    suggestionContextChars: number;
    answerContextChars: number;
    liveSuggestionPrompt: string;
    expandedAnswerPrompt: string;
    chatPrompt: string;
  };
};

const SETTINGS_KEY = "twinmind.settings.v1";
const SESSION_KEY = "twinmind.session.v1";

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function formatSuggestionKind(kind: SuggestionKind) {
  return kind.replace("-", " ");
}

function buildRecentTranscript(entries: TranscriptEntry[], chars: number) {
  return entries
    .slice()
    .reverse()
    .reduce<string[]>((chunks, entry) => {
      const next = `[${formatTime(entry.createdAt)}] ${entry.text}`;
      const joined = [next, ...chunks].join("\n");

      if (joined.length > chars && chunks.length > 0) {
        return chunks;
      }

      return [next, ...chunks];
    }, [])
    .join("\n");
}

function downloadJson(filename: string, data: SessionBundle) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AppShell() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [statusMessage, setStatusMessage] = useState("Paste a Groq API key in Settings to begin.");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [countdown, setCountdown] = useState(DEFAULT_SETTINGS.transcriptChunkSeconds);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const suggestionRef = useRef<SuggestionBatch[]>([]);
  const chatRef = useRef<ChatMessage[]>([]);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const flushResolverRef = useRef<(() => void) | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const transcriptionQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const storedSettings = window.localStorage.getItem(SETTINGS_KEY);
    const storedSession = window.localStorage.getItem(SESSION_KEY);

    if (storedSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) });
    }

    if (storedSession) {
      const parsed = JSON.parse(storedSession) as Partial<SessionBundle>;
      setTranscript(parsed.transcript ?? []);
      setSuggestionBatches(parsed.suggestionBatches ?? []);
      setChatHistory(parsed.chatHistory ?? []);
    }
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    transcriptRef.current = transcript;
    suggestionRef.current = suggestionBatches;
    chatRef.current = chatHistory;

    const serializable: SessionBundle = {
      transcript,
      suggestionBatches,
      chatHistory,
      exportedAt: new Date().toISOString(),
      settings: {
        transcriptChunkSeconds: settingsRef.current.transcriptChunkSeconds,
        suggestionContextChars: settingsRef.current.suggestionContextChars,
        answerContextChars: settingsRef.current.answerContextChars,
        liveSuggestionPrompt: settingsRef.current.liveSuggestionPrompt,
        expandedAnswerPrompt: settingsRef.current.expandedAnswerPrompt,
        chatPrompt: settingsRef.current.chatPrompt,
      },
    };

    window.localStorage.setItem(SESSION_KEY, JSON.stringify(serializable));
  }, [chatHistory, suggestionBatches, transcript]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [transcript]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chatHistory]);

  useEffect(() => {
    if (recorderState !== "recording") {
      setCountdown(settings.transcriptChunkSeconds);
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      return;
    }

    setCountdown(settings.transcriptChunkSeconds);
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((current) =>
        current <= 1 ? settingsRef.current.transcriptChunkSeconds : current - 1,
      );
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [recorderState, settings.transcriptChunkSeconds]);

  const transcriptWindow = useMemo(
    () => buildRecentTranscript(transcript, settings.suggestionContextChars),
    [settings.suggestionContextChars, transcript],
  );

  const canGenerate = settings.groqApiKey.trim().length > 0;

  async function transcribeChunk(blob: Blob) {
    if (!blob.size) {
      flushResolverRef.current?.();
      flushResolverRef.current = null;
      return;
    }

    const snapshot = settingsRef.current;
    const startedAt = new Date().toISOString();

    transcriptionQueueRef.current = transcriptionQueueRef.current.then(async () => {
      const form = new FormData();
      form.append("audio", blob, `chunk-${Date.now()}.webm`);
      form.append("apiKey", snapshot.groqApiKey);

      try {
        setStatusMessage("Transcribing latest audio chunk...");
        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as { text: string };
        if (!data.text.trim()) {
          return;
        }

        const entry: TranscriptEntry = {
          id: uid("transcript"),
          text: data.text.trim(),
          createdAt: new Date().toISOString(),
          startedAt,
        };

        setTranscript((current) => [...current, entry]);
        setStatusMessage("Transcript updated.");
        await generateSuggestions("auto");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed.";
        setStatusMessage(message);
      } finally {
        flushResolverRef.current?.();
        flushResolverRef.current = null;
      }
    });

    await transcriptionQueueRef.current;
  }

  async function startRecording() {
    if (!canGenerate) {
      setSettingsOpen(true);
      setStatusMessage("Add a Groq API key before starting the mic.");
      return;
    }

    try {
      setRecorderState("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = async (event) => {
        await transcribeChunk(event.data);
      };
      recorder.onstart = () => {
        setStatusMessage(
          `Listening live. Transcript will append every ${settingsRef.current.transcriptChunkSeconds} seconds.`,
        );
      };
      recorder.onstop = () => {
        setRecorderState("idle");
        setStatusMessage("Mic stopped.");
      };

      recorder.start(settings.transcriptChunkSeconds * 1000);
      mediaRecorderRef.current = recorder;
      streamRef.current = stream;
      setRecorderState("recording");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access microphone.";
      setRecorderState("idle");
      setStatusMessage(message);
    }
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current || recorderState !== "recording") {
      return;
    }

    setRecorderState("stopping");
    mediaRecorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
  }

  async function flushCurrentAudio() {
    if (mediaRecorderRef.current?.state !== "recording") {
      return;
    }

    await new Promise<void>((resolve) => {
      flushResolverRef.current = resolve;
      mediaRecorderRef.current?.requestData();
    });
  }

  async function generateSuggestions(trigger: "auto" | "manual") {
    if (!settingsRef.current.groqApiKey.trim()) {
      return;
    }

    const currentTranscript = transcriptRef.current;
    if (!currentTranscript.length) {
      return;
    }

    const recentTranscript = buildRecentTranscript(
      currentTranscript,
      settingsRef.current.suggestionContextChars,
    );

    try {
      if (trigger === "manual") {
        setIsRefreshing(true);
      }

      setStatusMessage("Generating fresh suggestions...");
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: settingsRef.current.groqApiKey,
          prompt: settingsRef.current.liveSuggestionPrompt,
          recentTranscript,
          suggestionHistory: suggestionRef.current.slice(0, 4),
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as { suggestions: Suggestion[] };
      const batch: SuggestionBatch = {
        id: uid("batch"),
        createdAt: new Date().toISOString(),
        trigger,
        suggestions: data.suggestions.map((suggestion) => ({
          ...suggestion,
          id: uid("suggestion"),
        })),
      };

      setSuggestionBatches((current) => [batch, ...current]);
      setStatusMessage("Suggestions refreshed.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to generate suggestions.";
      setStatusMessage(message);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleRefresh() {
    if (!canGenerate) {
      setSettingsOpen(true);
      return;
    }

    setIsRefreshing(true);
    await flushCurrentAudio();
    await generateSuggestions("manual");
  }

  async function streamAssistantReply(
    userContent: string,
    source: ChatMessage["source"],
    suggestion?: Suggestion,
  ) {
    if (!canGenerate) {
      setSettingsOpen(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: uid("chat"),
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
      source,
      suggestionId: suggestion?.id,
    };

    const assistantId = uid("chat");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      source,
      suggestionId: suggestion?.id,
    };

    setChatHistory((current) => [...current, userMessage, assistantMessage]);
    setIsReplying(true);
    setActiveSuggestionId(suggestion?.id ?? null);
    setStatusMessage("Fetching detailed answer...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: settingsRef.current.groqApiKey,
          prompt:
            source === "suggestion-click"
              ? settingsRef.current.expandedAnswerPrompt
              : settingsRef.current.chatPrompt,
          transcriptContext: buildRecentTranscript(
            transcriptRef.current,
            settingsRef.current.answerContextChars,
          ),
          conversation: [...chatRef.current, userMessage].map((message) => ({
            role: message.role,
            content: message.content,
          })),
          question: userContent,
          suggestion,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finalText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        finalText += decoder.decode(value, { stream: true });
        setChatHistory((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: finalText } : message,
          ),
        );
      }

      setStatusMessage("Detailed answer ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat response failed.";
      setChatHistory((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content: `Sorry, I couldn't complete that answer.\n\n${message}`,
              }
            : entry,
        ),
      );
      setStatusMessage(message);
    } finally {
      setIsReplying(false);
      setActiveSuggestionId(null);
    }
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function exportSession() {
    const payload: SessionBundle = {
      transcript,
      suggestionBatches,
      chatHistory,
      exportedAt: new Date().toISOString(),
      settings: {
        transcriptChunkSeconds: settings.transcriptChunkSeconds,
        suggestionContextChars: settings.suggestionContextChars,
        answerContextChars: settings.answerContextChars,
        liveSuggestionPrompt: settings.liveSuggestionPrompt,
        expandedAnswerPrompt: settings.expandedAnswerPrompt,
        chatPrompt: settings.chatPrompt,
      },
    };

    downloadJson(`twinmind-session-${Date.now()}.json`, payload);
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">TwinMind-inspired realtime copilot</p>
          <h1>Live Suggestions</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={exportSession}>
            Export session
          </button>
          <button className="secondary-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </div>

      <div className="statusbar">
        <span>{statusMessage}</span>
        <span>{recorderState === "recording" ? `auto-refresh in ${countdown}s` : "session only"}</span>
      </div>

      <section className="workspace-grid">
        <div className="panel">
          <div className="panel-header">
            <span>1. Mic &amp; Transcript</span>
            <span>{recorderState.toUpperCase()}</span>
          </div>

          <div className="mic-row">
            <button
              className={`mic-button ${recorderState === "recording" ? "mic-live" : ""}`}
              onClick={recorderState === "recording" ? stopRecording : startRecording}
              disabled={recorderState === "requesting" || recorderState === "stopping"}
            >
              <span className="mic-core" />
            </button>
            <div>
              <h2>
                {recorderState === "recording" ? "Listening now" : "Click mic to start"}
              </h2>
              <p>Transcript appends every ~{settings.transcriptChunkSeconds}s and scrolls automatically.</p>
            </div>
          </div>

          <div className="callout">
            <p>
              Transcription uses Groq Whisper Large V3. Each chunk is appended to the
              running transcript and immediately feeds the next suggestion refresh.
            </p>
          </div>

          <div className="scroll-panel transcript-panel">
            {transcript.length ? (
              transcript.map((entry) => (
                <article key={entry.id} className="transcript-entry">
                  <div className="timestamp">{formatTime(entry.createdAt)}</div>
                  <p>{entry.text}</p>
                </article>
              ))
            ) : (
              <div className="empty-copy">No transcript yet. Start the mic to begin.</div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span>2. Live Suggestions</span>
            <span>{suggestionBatches.length} batches</span>
          </div>

          <div className="suggestions-toolbar">
            <button className="secondary-button" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Reload suggestions"}
            </button>
            <span>uses last {settings.suggestionContextChars} transcript chars</span>
          </div>

          {suggestionBatches.length ? (
            <div className="scroll-panel batches-panel">
              {suggestionBatches.map((batch, batchIndex) => (
                <section
                  key={batch.id}
                  className={`batch ${batchIndex > 0 ? "batch-older" : ""}`}
                >
                  <div className="batch-header">
                    <strong>{batch.trigger === "auto" ? "Auto refresh" : "Manual refresh"}</strong>
                    <span>{formatTime(batch.createdAt)}</span>
                  </div>
                  <div className="suggestion-list">
                    {batch.suggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        className={`suggestion-card ${
                          activeSuggestionId === suggestion.id ? "suggestion-active" : ""
                        }`}
                        onClick={() => streamAssistantReply(suggestion.title, "suggestion-click", suggestion)}
                      >
                        <div className="suggestion-meta">
                          <span>{formatSuggestionKind(suggestion.kind)}</span>
                          <span>{suggestion.whyNow}</span>
                        </div>
                        <h3>{suggestion.title}</h3>
                        <p>{suggestion.preview}</p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-copy empty-fill">
              Suggestions appear here once transcript context is available.
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <span>3. Chat</span>
            <span>session-only</span>
          </div>

          <div className="scroll-panel chat-panel">
            {chatHistory.length ? (
              chatHistory.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message ${
                    message.role === "assistant" ? "assistant-message" : "user-message"
                  }`}
                >
                  <div className="chat-meta">
                    <span>{message.role === "assistant" ? "Assistant" : "You"}</span>
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                  <p>{message.content || (message.role === "assistant" && isReplying ? "..." : "")}</p>
                </article>
              ))
            ) : (
              <div className="empty-copy empty-fill">
                Click a suggestion or ask a follow-up question directly.
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!composer.trim() || isReplying) {
                return;
              }
              const nextQuestion = composer.trim();
              setComposer("");
              void streamAssistantReply(nextQuestion, "chat");
            }}
          >
            <input
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Ask anything..."
            />
            <button className="primary-button" type="submit" disabled={isReplying}>
              Send
            </button>
          </form>
        </div>
      </section>

      {settingsOpen ? (
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Prompt controls</p>
                <h2>Settings</h2>
              </div>
              <button className="secondary-button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>

            <label className="field">
              <span>Groq API key</span>
              <input
                type="password"
                value={settings.groqApiKey}
                onChange={(event) => updateSetting("groqApiKey", event.target.value)}
                placeholder="gsk_..."
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>Transcript chunk seconds</span>
                <input
                  type="number"
                  min={10}
                  max={60}
                  value={settings.transcriptChunkSeconds}
                  onChange={(event) =>
                    updateSetting("transcriptChunkSeconds", Number(event.target.value))
                  }
                />
              </label>

              <label className="field">
                <span>Live suggestion context chars</span>
                <input
                  type="number"
                  min={1200}
                  max={12000}
                  step={200}
                  value={settings.suggestionContextChars}
                  onChange={(event) =>
                    updateSetting("suggestionContextChars", Number(event.target.value))
                  }
                />
              </label>

              <label className="field">
                <span>Detailed answer context chars</span>
                <input
                  type="number"
                  min={1200}
                  max={18000}
                  step={200}
                  value={settings.answerContextChars}
                  onChange={(event) =>
                    updateSetting("answerContextChars", Number(event.target.value))
                  }
                />
              </label>
            </div>

            <label className="field">
              <span>Live suggestion prompt</span>
              <textarea
                rows={12}
                value={settings.liveSuggestionPrompt}
                onChange={(event) => updateSetting("liveSuggestionPrompt", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Expanded answer prompt</span>
              <textarea
                rows={10}
                value={settings.expandedAnswerPrompt}
                onChange={(event) => updateSetting("expandedAnswerPrompt", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Freeform chat prompt</span>
              <textarea
                rows={10}
                value={settings.chatPrompt}
                onChange={(event) => updateSetting("chatPrompt", event.target.value)}
              />
            </label>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
