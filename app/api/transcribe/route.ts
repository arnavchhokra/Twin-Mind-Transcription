import { NextResponse } from "next/server";
import { transcribeWithGroq } from "@/lib/server/groq";

export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  const apiKey = formData.get("apiKey");

  if (!(audio instanceof File) || typeof apiKey !== "string" || !apiKey.trim()) {
    return new NextResponse("Missing audio file or API key.", { status: 400 });
  }

  try {
    const result = await transcribeWithGroq(apiKey, audio);
    return NextResponse.json({ text: result.text ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return new NextResponse(message, { status: 500 });
  }
}
