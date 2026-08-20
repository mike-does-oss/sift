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
  title: {
    default: "Sift — turn documents into structured data",
    template: "%s — Sift",
  },
  description:
    "Open-source document extraction that runs local-first and private by default. Define fields, drop in documents, get structured data back.",
  openGraph: {
    title: "Sift — turn documents into structured data",
    description:
      "Open-source document extraction that runs local-first and private by default.",
    images: ["/logo-512.png"],
  },
};

// Pre-hydration theme init: dark is the default calibration (:root), light is
// the `html.light` opt-in. Without this, a visitor whose stored/OS preference
// is light gets a dark first paint until Sidebar's post-hydration effect runs
// (R1's theme inversion introduced that flash). Same mapping as Sidebar.tsx:
// stored "light" → html.light; nothing stored → OS preference; stored "dark"
// (or anything else) → default. Parser-blocking inline script so it runs
// before first paint; try/catch for storage-disabled contexts.
const THEME_INIT = `try{var t=localStorage.getItem("sift-theme");if(t==="light"||(!t&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.classList.add("light")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme script above legitimately mutates
    // <html>'s class list before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`}
    >
      <body className="antialiased min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
