import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
