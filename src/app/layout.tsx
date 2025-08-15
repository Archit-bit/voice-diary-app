import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voice Diary",
  description: "Record a quick audio log and track your day.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="sticky top-0 z-10 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl gap-4 px-4 py-3 text-sm">
            <a href="/" className="text-neutral-200 hover:text-white">
              Record
            </a>
            <a
              href="/dashboard/logs"
              className="text-neutral-400 hover:text-white"
            >
              Logs
            </a>
            <a href="/dashboard" className="text-neutral-400 hover:text-white">
              Dashboard
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
