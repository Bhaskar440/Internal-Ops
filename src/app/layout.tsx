import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Each page sets its own title; this appends the product name so a browser
  // tab or bookmark says what the app is, not just which screen.
  title: {
    default: "Portfolio Ops",
    template: "%s · Portfolio Ops",
  },
  description:
    "Internal operating system for cross-venture operations, HR, time tracking and payroll.",
  applicationName: "Portfolio Ops",
  // Internal tool: keep it out of search results.
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
