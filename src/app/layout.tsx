import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PublicAnalytics from "./PublicAnalytics";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "otwartestoki.pl",
  description: "Warunki na stokach narciarskich",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <head />

      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PublicAnalytics />
        {children}
      </body>
    </html>
  );
}
