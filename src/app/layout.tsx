import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsightWire — AI Article Generator",
  description: "BNA-style article generation powered by AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <body style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
