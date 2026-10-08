import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The credential store is the only place a secret lives. These tests pin the two
 * behaviours the runtime depends on: vault round-trip (encrypted at rest, plaintext
 * never on disk) and the environment fallback that keeps existing keys working.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-credential-"));
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const credentials = await import("@/lib/credentials");

describe("credential store", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEYS;
  });

  it("parses refs and rejects anything that is not one", () => {
    expect(credentials.credentialRefFor("Qwen")).toBe("credential://qwen/default");
    expect(credentials.parseCredentialRef("credential://qwen/team-2")).toEqual({ slug: "qwen", name: "team-2" });
    expect(credentials.parseCredentialRef("sk-plain-key")).toBeNull();
    expect(credentials.credentialEnvVarNames("qwen")).toEqual(["QWEN_API_KEYS", "QWEN_API_KEY"]);
  });

  it("round-trips a key through the encrypted vault without writing plaintext", async () => {
    const ref = credentials.credentialRefFor("qwen");
    const stored = await credentials.writeCredential(ref, "sk-qwen-secret");

    expect(stored).toMatchObject({ backend: "file-encrypted", configured: true, source: "vault" });
    expect(stored.masked.endsWith("cret")).toBe(true);
    expect(await credentials.readCredential(ref)).toBe("sk-qwen-secret");

    const vaultRaw = await fs.readFile(path.join(dataDir, "credential-vault.json"), "utf-8");
    expect(vaultRaw).not.toContain("sk-qwen-secret");
  });

  it("ignores masked placeholders echoed by the UI and clears on an empty value", async () => {
    const ref = credentials.credentialRefFor("zhipu");
    await credentials.writeCredential(ref, "sk-real-key");
    await credentials.writeCredential(ref, "********-key");
    expect(await credentials.readCredential(ref)).toBe("sk-real-key");

    await credentials.writeCredential(ref, "");
    expect(await credentials.readCredential(ref)).toBeNull();
    expect(await credentials.describeCredential(ref)).toMatchObject({ configured: false, source: "none" });
  });

  it("falls back to the environment so legacy keys keep working", async () => {
    process.env.DEEPSEEK_API_KEYS = "sk-env-one,sk-env-two";
    const ref = credentials.credentialRefFor("deepseek");

    expect(await credentials.readCredential(ref)).toBe("sk-env-one");
    expect(await credentials.describeCredential(ref)).toMatchObject({
      backend: "env-only",
      source: "env",
      configured: true,
    });
  });

  it("keeps every key of a multi-key credential, in rotation order", async () => {
    const ref = credentials.credentialRefFor("moonshot");
    const stored = await credentials.writeCredential(ref, "sk-moon-one\nsk-moon-two, sk-moon-three;sk-moon-one");

    expect(stored).toMatchObject({ configured: true, keyCount: 3, source: "vault" });
    // Order is the rotation order; the repeated key collapses instead of rotating twice.
    expect(await credentials.readCredentialKeys(ref)).toEqual(["sk-moon-one", "sk-moon-two", "sk-moon-three"]);
    expect(await credentials.readCredential(ref)).toBe("sk-moon-one");
    expect(stored.maskedKeys).toHaveLength(3);
    expect(stored.maskedKeys.every((masked) => masked.startsWith("*"))).toBe(true);

    const vaultRaw = await fs.readFile(path.join(dataDir, "credential-vault.json"), "utf-8");
    expect(vaultRaw).not.toContain("sk-moon-one");
    expect(vaultRaw).not.toContain("sk-moon-two");
  });

  it("splits keys out of the environment as well", async () => {
    process.env.DEEPSEEK_API_KEYS = "sk-env-one,sk-env-two\nsk-env-three";
    const ref = credentials.credentialRefFor("deepseek");

    expect(await credentials.readCredentialKeys(ref)).toEqual(["sk-env-one", "sk-env-two", "sk-env-three"]);
    expect(await credentials.describeCredential(ref)).toMatchObject({ keyCount: 3, source: "env" });
  });

  it("drops masked placeholders instead of treating them as keys", async () => {
    const ref = credentials.credentialRefFor("qwen");
    await credentials.writeCredential(ref, "sk-real-key");

    // The UI echoes `****1234` back when a form is re-saved without touching the field.
    expect(await credentials.splitCredentialKeys("********-key")).toEqual(["********-key"]);
    await credentials.writeCredential(ref, "****real-key");
    expect(await credentials.readCredentialKeys(ref)).toEqual(["sk-real-key"]);

    await credentials.writeCredential(ref, "sk-real-key,****other");
    expect(await credentials.readCredentialKeys(ref)).toEqual(["sk-real-key"]);
  });

  it("reports that no OS keychain backend is installed", () => {
    expect(credentials.osSecureStorage.available).toBe(false);
  });
});
