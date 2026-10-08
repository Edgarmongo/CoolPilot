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
    // Vitest's own default is 5s. A cold, repository-wide run can amplify a test that costs ~0.5s on
    // its own more than tenfold (P4-b-1: `runtime.test.ts`'s seed test at 493-583ms, 7052ms for a
    // sibling first test in the worst observed run), so the budget is twice the worst test measured.
    testTimeout: 15000,
  },
});
