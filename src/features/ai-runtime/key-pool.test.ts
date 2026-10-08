import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppError as AppErrorType } from "@/lib/app-errors";

/**
 * Credential rotation against a throwaway SQLite file. These tests pin the state machine
 * from `docs/model-layer-spec.md` §5.2: a 429 cools a key down, a 401 retires it, a failure
 * that is not the key's fault leaves it healthy, and the runtime stops instead of burning
 * every key on a request the provider will keep rejecting.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-keypool-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "keypool.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const keyPool = await import("./key-pool");
const credentials = await import("@/lib/credentials");
const repository = await import("@/db/repositories/ai-runtime");
const { AppError } = await import("@/lib/app-errors");

const refFor = (slug: string) => credentials.credentialRefFor(slug);

function rateLimited(retryAfterMs = 60_000) {
  return new AppError("MODEL_RATE_LIMITED", {
    status: 429,
    message: "slow down",
    details: { status: 429, retryAfterMs },
  });
}

function unauthorized() {
  return new AppError("MODEL_CREDENTIAL_INVALID", { status: 502, message: "bad key", details: { status: 401 } });
}

function badRequest() {
  return new AppError("MODEL_UPSTREAM_FAILED", { status: 502, message: "bad request", details: { status: 400 } });
}

function serverError() {
  return new AppError("MODEL_UPSTREAM_FAILED", { status: 502, message: "boom", details: { status: 500 } });
}

/** Awaits a call that is expected to fail and hands back the `AppError` it threw. */
async function expectAppError(promise: Promise<unknown>) {
  return (await promise.catch((failure: unknown) => failure)) as AppErrorType;
}

describe("credential key pool", () => {
  it("rotates to the next key when the provider rate-limits the first", async () => {
    const ref = refFor("qwen");
    await credentials.writeCredential(ref, "sk-qwen-one\nsk-qwen-two");

    const tried: string[] = [];
    const result = await keyPool.runWithCredentialKey({ ref, providerId: "qwen" }, async (secret) => {
      tried.push(secret as string);
      if (tried.length === 1) throw rateLimited();
      return "pong";
    });

    expect(tried).toEqual(["sk-qwen-one", "sk-qwen-two"]);
    expect(result.value).toBe("pong");
    // Only the masked tail is ever returned - never the key itself.
    expect(result.keyLabel.endsWith("two")).toBe(true);
    expect(result.keyLabel).not.toContain("sk-qwen-two");

    const { health } = await keyPool.planCredentialKeys({ ref, providerId: "qwen" });
    expect(health.map((key) => key.status)).toEqual(["rate_limited", "ok"]);
    expect(health[0].skipReason).toBe("cooling-down");
    expect(health[0].cooldownUntil ?? 0).toBeGreaterThan(Date.now());
    expect(health[1].cooldownUntil).toBeNull();
    expect(health[1].useCount).toBe(1);
  });

  it("keeps a cooling key out of rotation until it is forced or reset", async () => {
    const ref = refFor("deepseek");
    await credentials.writeCredential(ref, "sk-deep-one\nsk-deep-two");

    let calls = 0;
    await keyPool
      .runWithCredentialKey({ ref, providerId: "deepseek" }, async () => {
        calls += 1;
        if (calls === 1) throw rateLimited();
        return "ok";
      })
      .catch(() => undefined);

    const first = await keyPool.runWithCredentialKey({ ref, providerId: "deepseek" }, async () => "ok");
    expect(first.keyLabel.endsWith("two")).toBe(true);

    // `force` is the "仍然尝试" escape hatch the UI offers for troubleshooting.
    const forced = await keyPool.planCredentialKeys({ ref, providerId: "deepseek", force: true });
    expect(forced.selections).toHaveLength(2);
    expect(forced.selections[1].status).toBe("rate_limited");

    await keyPool.resetCredentialKey(forced.selections[1].keyId);
    const afterReset = await keyPool.planCredentialKeys({ ref, providerId: "deepseek" });
    expect(afterReset.selections).toHaveLength(2);
  });

  it("retires a rejected key and reports every failed attempt to the caller", async () => {
    const ref = refFor("zhipu");
    await credentials.writeCredential(ref, "sk-zhipu-bad\nsk-zhipu-good");

    const failures: string[] = [];
    let calls = 0;
    const result = await keyPool.runWithCredentialKey(
      { ref, providerId: "zhipu", onKeyFailure: ({ keyLabel }) => failures.push(keyLabel) },
      async () => {
        calls += 1;
        if (calls === 1) throw unauthorized();
        return "pong";
      },
    );

    expect(result.value).toBe("pong");
    expect(failures).toHaveLength(1);
    expect(failures[0].endsWith("bad")).toBe(true);

    const { health } = await keyPool.planCredentialKeys({ ref, providerId: "zhipu" });
    expect(health[0].status).toBe("invalid");
    expect(health[0].errorCount).toBe(1);

    // An invalid key is not retried on the next call: the healthy one signs it directly.
    const next = await keyPool.runWithCredentialKey({ ref, providerId: "zhipu" }, async () => "pong");
    expect(next.keyLabel.endsWith("good")).toBe(true);
  });

  it("does not punish the key for a request the provider will reject anyway", async () => {
    const ref = refFor("moonshot");
    await credentials.writeCredential(ref, "sk-moon-one\nsk-moon-two");

    await expect(
      keyPool.runWithCredentialKey({ ref, providerId: "moonshot" }, async () => {
        throw badRequest();
      }),
    ).rejects.toMatchObject({ code: "MODEL_UPSTREAM_FAILED" });

    const { health } = await keyPool.planCredentialKeys({ ref, providerId: "moonshot" });
    expect(health.every((key) => key.status === "unknown")).toBe(true);
    // Only the key that was actually handed to the provider is counted as used.
    expect(health.map((key) => key.useCount)).toEqual([1, 0]);
  });

  it("treats a 5xx as transient: the key stays usable", async () => {
    const ref = refFor("groq");
    await credentials.writeCredential(ref, "sk-groq-one");

    await expect(
      keyPool.runWithCredentialKey({ ref, providerId: "groq" }, async () => {
        throw serverError();
      }),
    ).rejects.toMatchObject({ code: "MODEL_UPSTREAM_FAILED" });

    const { health } = await keyPool.planCredentialKeys({ ref, providerId: "groq" });
    expect(health[0]).toMatchObject({ status: "unknown", errorCount: 0 });
    expect(health[0].skipReason).toBeUndefined();
  });

  it("returns a key to rotation once its cooldown has expired", async () => {
    const ref = refFor("xinghuo");
    await credentials.writeCredential(ref, "sk-star-one");
    const { selections } = await keyPool.planCredentialKeys({ ref, providerId: "xinghuo" });

    await repository.markCredentialKeyFailure({
      id: selections[0].keyId,
      status: "rate_limited",
      cooldownUntil: Date.now() - 1_000,
    });
    const cooling = await keyPool.planCredentialKeys({ ref, providerId: "xinghuo" });
    expect(cooling.selections).toHaveLength(1);
    expect(cooling.health[0].status).toBe("unknown");
    expect(cooling.health[0].cooldownUntil).toBeNull();
  });

  it("explains an exhausted pool instead of pretending there is no key", async () => {
    const ref = refFor("openai");
    await credentials.writeCredential(ref, "sk-openai-one\nsk-openai-two");

    const { selections } = await keyPool.planCredentialKeys({ ref, providerId: "openai" });
    for (const selection of selections) {
      await keyPool.setCredentialKeyEnabled(selection.keyId, false);
    }

    const error = await expectAppError(
      keyPool.runWithCredentialKey({ ref, providerId: "openai" }, async () => "never"),
    );
    expect(error.code).toBe("MODEL_CREDENTIAL_UNAVAILABLE");
    const details = error.details as { reasons?: string[]; keys?: Array<{ status: string }> };
    expect(details.reasons).toEqual(["disabled"]);
    expect(details.keys).toHaveLength(2);
  });

  it("runs a keyless endpoint only when the caller allows it", async () => {
    const ref = refFor("local-llama");
    expect(await credentials.readCredentialKeys(ref)).toEqual([]);

    const denied = await expectAppError(
      keyPool.runWithCredentialKey({ ref, providerId: "local-llama" }, async () => "never"),
    );
    expect(denied.code).toBe("MODEL_CREDENTIAL_MISSING");

    const allowed = await keyPool.runWithCredentialKey(
      { ref, providerId: "local-llama", allowKeyless: true },
      async (secret) => (secret === null ? "no-key-needed" : "unexpected"),
    );
    expect(allowed).toMatchObject({ value: "no-key-needed", keyLabel: "", keyId: "" });
  });

  it("remembers keys by fingerprint and never writes the key itself", async () => {
    const ref = refFor("minimax");
    await credentials.writeCredential(ref, "sk-minimax-secret");

    await keyPool.runWithCredentialKey({ ref, providerId: "minimax" }, async () => "ok");
    const [record] = await repository.listCredentialKeys(ref);

    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.fingerprint).toBe(keyPool.credentialKeyFingerprint("sk-minimax-secret"));
    expect(record.masked.endsWith("cret")).toBe(true);
  });

  it("drops health rows whose key was removed from the credential", async () => {
    const ref = refFor("baichuan");
    await credentials.writeCredential(ref, "sk-baichuan-one\nsk-baichuan-two");
    await keyPool.planCredentialKeys({ ref, providerId: "baichuan" });
    expect(await repository.listCredentialKeys(ref)).toHaveLength(2);

    await credentials.writeCredential(ref, "sk-baichuan-two");
    const { health } = await keyPool.planCredentialKeys({ ref, providerId: "baichuan" });
    expect(health).toHaveLength(1);
    expect(await repository.listCredentialKeys(ref)).toHaveLength(1);
  });
});
