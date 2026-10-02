import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caderno PMBA",
  description: "Seu edital da PMBA organizado para estudar, resumir e revisar.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
