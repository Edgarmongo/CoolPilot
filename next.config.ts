import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Hide the Next.js DevTools indicator (the floating "N" button injected into
  // the document by Next.js in development). This only affects `next dev`;
  // production builds never render it. Build/runtime errors are still shown.
  devIndicators: false,
  transpilePackages: [
    "@plait-board/markdown-to-drawnix",
    "@plait-board/mermaid-to-drawnix",
    "@plait/common",
    "@plait/core",
    "@plait/draw",
    "@plait/layouts",
    "@plait/mind",
    "@plait/text-plugins",
  ],
  outputFileTracingExcludes: {
    "/*": [
      "./web-data/**/*",
      "./dist-electron/**/*",
      "./.playwright-cli/**/*",
      "./playwright-report/**/*",
      "./test-results/**/*",
    ],
  },
};

export default nextConfig;
