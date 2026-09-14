import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "vackrooms — You’ve been here before.",
  description:
    "An endless first-person backrooms labyrinth. Oppressive fluorescent lights, forgotten rooms, and a tape that keeps rolling. Built with Next.js, Three.js, and vgpu.",
  openGraph: {
    title: "vackrooms.",
    description: "You’ve been here before. You just don’t remember when.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#242419",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable}`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
