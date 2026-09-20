import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const social = {
  title: "vackrooms",
  description:
    "Backrooms, made with vgpu and three.js. You’ve been here before. You just don’t remember when.",
};
export const metadata: Metadata = {
  metadataBase: new URL("https://vackrooms.vercel.app"),
  title: "vackrooms — You’ve been here before.",
  description:
    "A backrooms game made with vgpu and three.js. An endless first-person labyrinth of oppressive fluorescent lights, forgotten rooms, and a tape that keeps rolling.",
  alternates: { canonical: "/" },
  openGraph: {
    ...social,
    url: "/",
    siteName: "vackrooms",
    type: "website",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", ...social },
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
