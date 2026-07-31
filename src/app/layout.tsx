import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Playbook §13 type system: Space Grotesk for headings/brand/eyebrows, Inter
// for UI/body, IBM Plex Mono for data (field keys, extracted values, code).
// Each exposes a CSS var consumed by globals.css (--font-display/--font-body/
// --font-mono) so the rest of the app never imports a font directly.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sift | Local-First Document Extraction",
  description: "Extract structured data from documents, locally and privately",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
