import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Provider keys always come from the test, never from the machine's `.env.local` - see the file.
    setupFiles: ["./src/test/app-env.ts"],
  },
});
