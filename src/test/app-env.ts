import fs from "node:fs";
import path from "node:path";
import { aiProviderOrder } from "@/features/ai-settings/provider-registry";
import { credentialEnvVarNames } from "@/lib/credentials";

/**
 * Provider keys in the test process are decided here, never by the machine running the suite.
 *
 * `lib/credentials.ts` resolves a credential from `process.env` first and then from the app env
 * file - `.env.local` in the repository root, which setup and the settings screen both write.
 * Vitest does not load that file, but the runtime reads it directly, and since the seed performs
 * cold-start catalog discovery (D-P3-1 of `docs/generate-migration-p3.md`) the keys of whoever runs
 * the suite would decide which providers a test can route to - and would send real requests out of
 * the test process.
 *
 * Every key variable therefore gets a defined value that holds no keys: `readAppEnvValue()` sees a
 * non-empty value and never falls back to the file, while the splitter turns `,` into zero keys. A
 * test that wants a key writes one (vault or `process.env`) and wins from there on.
 *
 * Test files used to `delete process.env[name]` for the same reason. Neutralising is strictly
 * stronger, because deleting hands the variable straight back to the file. `*_MODEL` variables are
 * deliberately left to the test files: an empty value is falsy there, so the sentinel would name a
 * model "," instead of leaving the provider unconfigured.
 */
export const keylessAppEnvValue = ",";

/** The spellings a real install may hold a provider key in, for every provider the runtime knows. */
function providerKeyVarNames() {
  const names = new Set<string>();
  for (const providerId of aiProviderOrder) {
    for (const varName of credentialEnvVarNames(providerId)) {
      names.add(varName);
    }
  }
  return names;
}

/**
 * Key variables this checkout's env file declares, so a key spelling that is not in the list above
 * cannot slip through either. Only `.env.local` is read when it exists, exactly like `readEnvValue()`
 * in `lib/secrets.ts`.
 */
function appEnvFileKeyVarNames() {
  for (const file of [".env.local", ".env"]) {
    try {
      return fs
        .readFileSync(path.join(process.cwd(), file), "utf-8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
        .map((line) => line.slice(0, line.indexOf("=")).trim())
        .filter((varName) => /(^|_)(API_KEY|API_KEYS)$/.test(varName));
    } catch {
      // Not present: an install may keep its keys in `.env` only.
    }
  }
  return [];
}

for (const varName of new Set([...providerKeyVarNames(), ...appEnvFileKeyVarNames()])) {
  process.env[varName] = keylessAppEnvValue;
}
