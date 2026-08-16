import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output serves the Docker/Electron packaging paths; Vercel's
  // builder manages its own output format and must not get standalone.
  output: process.env.VERCEL ? undefined : "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
