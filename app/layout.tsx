import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TwinMind Live Suggestions",
  description: "Realtime meeting copilot built on Groq.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
