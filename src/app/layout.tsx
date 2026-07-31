import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Playbook §13 type system: Space Grotesk for headings/brand/eyebrows, Inter
// for UI/body, IBM Plex Mono for data (field keys, extracted values, code).
//
// Each font gets its own next/font-generated CSS var (--font-space-grotesk/
// --font-inter/--font-ibm-plex-mono), NOT the semantic --font-display/
// --font-body/--font-mono names globals.css exposes to components — next/font
// packs its own computed local-fallback font (metric-matched to the web font,
// to avoid layout shift while it loads) into that variable's value, and
// redeclaring the same name in globals.css would silently clobber it.
// globals.css chains the semantic token to this variable instead.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
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
