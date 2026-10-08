import { createHash } from "node:crypto";
import { AppError } from "@/lib/app-errors";
import { readCredentialKeys } from "@/lib/credentials";
import { maskKey } from "@/lib/secrets";
import {
  deleteCredentialKeys,
  listCredentialKeys,
  markCredentialKeyFailure,
  markCredentialKeySuccess,
  markCredentialKeyUsed,
  setCredentialKeyStatus,
  upsertCredentialKey,
} from "@/db/repositories/ai-runtime";
import type { CredentialKeyHealth, CredentialKeyRecord, CredentialKeySkipReason, CredentialKeyStatus } from "./contracts";

/**
 * The credential layer's "which key do I use now?" question (`docs/model-layer-spec.md` §5).
 *
 * Keys are rotated instead of picked once: providers rate-limit per key, so a second key is
 * the difference between a retry and an outage. Health is remembered in SQLite keyed by a
 * SHA-256 fingerprint, which lets the runtime cool a 429'd key down without ever storing
 * the key itself.
 */

/** How long a key stays out of rotation after the provider rate-limited it. */
export const rateLimitCooldownMs = 60_000;

/** One-way identifier of a secret. High-entropy API keys cannot be recovered from this. */
export function credentialKeyFingerprint(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export type CredentialKeySelection = {
  keyId: string;
  ref: string;
  providerId: string;
  label: string;
  masked: string;
  fingerprint: string;
  status: CredentialKeyStatus;
  /** Plaintext, fetched for exactly this call. Never log it or return it. */
  secret: string;
};

export type CredentialKeyDiagnosis = {
  /** What the upstream failure says about the *key*. */
  status?: CredentialKeyStatus;
  cooldownMs?: number;
  /** False when the failure indicts the request or the model, not the key. */
  isKeyFault: boolean;
  /** True when handing the same call to another key is a sensible next move. */
  retryWithAnotherKey: boolean;
  /** True when the failure is worth handing to another model. */
  retryWithAnotherModel: boolean;
  message: string;
};

function errorCode(error: unknown) {
  return error instanceof AppError ? error.code : "";
}

function errorDetails(error: unknown): Record<string, unknown> {
  const details = error instanceof AppError ? error.details : undefined;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

function upstreamStatus(error: unknown) {
  return Number(errorDetails(error).status ?? 0);
}

/**
 * Reads an upstream failure. Adapters tag the interesting cases
 * (`MODEL_CREDENTIAL_INVALID`, `MODEL_CREDENTIAL_FORBIDDEN`, `MODEL_RATE_LIMITED`); anything
 * else is judged by the HTTP status it carries, and a bare network error is transient.
 */
export function diagnoseCredentialFailure(error: unknown): CredentialKeyDiagnosis {
  const code = errorCode(error);
  const status = upstreamStatus(error);
  const message = error instanceof Error ? error.message : "unknown error";

  if (code === "MODEL_CREDENTIAL_INVALID") {
    return { status: "invalid", isKeyFault: true, retryWithAnotherKey: true, retryWithAnotherModel: true, message };
  }
  if (code === "MODEL_CREDENTIAL_FORBIDDEN") {
    return { status: "forbidden", isKeyFault: true, retryWithAnotherKey: true, retryWithAnotherModel: true, message };
  }
  if (code === "MODEL_RATE_LIMITED") {
    const retryAfterMs = Number(errorDetails(error).retryAfterMs ?? 0);
    return {
      status: "rate_limited",
      cooldownMs: retryAfterMs > 0 ? retryAfterMs : rateLimitCooldownMs,
      isKeyFault: true,
      retryWithAnotherKey: true,
      retryWithAnotherModel: true,
      message,
    };
  }
  if (code === "MODEL_UPSTREAM_NO_CONTENT") {
    return { isKeyFault: false, retryWithAnotherKey: false, retryWithAnotherModel: true, message };
  }
  // Upstream 400/404/422 and our own endpoint validation: repeating the request anywhere
  // repeats the same rejection, so the runtime stops instead of burning keys.
  if (status === 400 || status === 404 || status === 422 || code === "MODEL_ENDPOINT_INVALID") {
    return { isKeyFault: false, retryWithAnotherKey: false, retryWithAnotherModel: false, message };
  }
  if (status === 401 || status === 402 || status === 403) {
    return {
      status: status === 401 ? "invalid" : "forbidden",
      isKeyFault: true,
      retryWithAnotherKey: true,
      retryWithAnotherModel: true,
      message,
    };
  }
  if (status === 429) {
    return {
      status: "rate_limited",
      cooldownMs: rateLimitCooldownMs,
      isKeyFault: true,
      retryWithAnotherKey: true,
      retryWithAnotherModel: true,
      message,
    };
  }
  // 5xx, 408, timeouts and DNS/network failures: not the key's fault, but a retry is cheap.
  return { isKeyFault: false, retryWithAnotherKey: true, retryWithAnotherModel: true, message };
}

/** True when the failure says "this key must not be used again for a while". */
export function isCredentialFault(error: unknown) {
  return diagnoseCredentialFailure(error).isKeyFault;
}

/** True when the failure means "stop trying": another model would repeat it verbatim. */
export function isFatalModelError(error: unknown) {
  return !diagnoseCredentialFailure(error).retryWithAnotherModel;
}

/** Why a key is currently excluded from rotation, or undefined when it takes part. */
function skipReasonFor(record: CredentialKeyRecord, now: number): CredentialKeySkipReason | undefined {
  if (record.status === "disabled") return "disabled";
  if (record.status === "invalid") return "invalid";
  if (record.status === "forbidden") return "forbidden";
  if (record.status === "rate_limited" && (record.cooldownUntil ?? 0) > now) return "cooling-down";
  return undefined;
}

async function registerKey(ref: string, providerId: string, secret: string, fingerprint: string) {
  return upsertCredentialKey({ credentialRef: ref, providerId, fingerprint, masked: maskKey(secret) });
}

export type CredentialKeyPlan = {
  /** Keys to try, best first: healthy before cooling down, least used first. */
  selections: CredentialKeySelection[];
  /** Every key of the credential with its current health, skipped ones included. */
  health: CredentialKeyHealth[];
};

/**
 * Rotation order (§5.2): healthy keys first, least-used first (`useCount`, then
 * `lastUsedAt`), then - only when the caller insists - the keys the pool would skip.
 * Registering happens here too, so a freshly pasted key enters the pool on first use, and
 * keys that were removed from the store lose their health row.
 */
export async function planCredentialKeys(input: { ref: string; providerId: string; force?: boolean }): Promise<CredentialKeyPlan> {
  const secrets = await readCredentialKeys(input.ref);
  if (secrets.length === 0) {
    return { selections: [], health: [] };
  }
  const now = Date.now();
  const registered = new Map((await listCredentialKeys(input.ref)).map((record) => [record.fingerprint, record]));

  const entries: Array<{ record: CredentialKeyRecord; secret: string; skipReason?: CredentialKeySkipReason }> = [];
  for (const secret of secrets) {
    const fingerprint = credentialKeyFingerprint(secret);
    let record = registered.get(fingerprint) ?? (await registerKey(input.ref, input.providerId, secret, fingerprint));
    registered.delete(fingerprint);
    // Spec §5.2: an expired cooldown returns the key to `unknown`, so the UI does not keep
    // showing "cooling down" for a key that is usable again.
    if (record.status === "rate_limited" && (record.cooldownUntil ?? 0) <= now) {
      await setCredentialKeyStatus(record.id, "unknown", null);
      record = { ...record, status: "unknown", cooldownUntil: null };
    }
    entries.push({ record, secret, skipReason: skipReasonFor(record, now) });
  }

  const leftovers = Array.from(registered.values());
  if (leftovers.length > 0) {
    await deleteCredentialKeys(leftovers.map((record) => record.id));
  }

  const usable = entries.filter((entry) => !entry.skipReason);
  const skipped = entries.filter((entry) => entry.skipReason);
  // Least-used key first, so consecutive calls spread over the whole set instead of
  // hammering key #1 until it rate-limits.
  const byUsage = (
    a: { record: CredentialKeyRecord },
    b: { record: CredentialKeyRecord },
  ) => a.record.useCount - b.record.useCount || (a.record.lastUsedAt ?? 0) - (b.record.lastUsedAt ?? 0);
  const ordered = [...usable.sort(byUsage), ...(input.force ? skipped.sort(byUsage) : [])];

  return {
    selections: ordered.map((entry) => ({
      keyId: entry.record.id,
      ref: entry.record.credentialRef,
      providerId: input.providerId,
      label: entry.record.label,
      masked: entry.record.masked,
      fingerprint: entry.record.fingerprint,
      status: entry.record.status,
      secret: entry.secret,
    })),
    health: entries.map((entry) => ({ ...entry.record, skipReason: entry.skipReason })),
  };
}

/** The honest version of "I could not pick a key": name every reason, hide nothing. */
function unavailableError(ref: string, health: CredentialKeyHealth[]): AppError {
  const reasons = Array.from(new Set(health.map((entry) => entry.skipReason).filter(Boolean))) as CredentialKeySkipReason[];
  const cooling = reasons.includes("cooling-down");
  return new AppError("MODEL_CREDENTIAL_UNAVAILABLE", {
    status: cooling ? 429 : 400,
    message: `No usable credential key for ${ref} (${reasons.length > 0 ? reasons.join(", ") : "no reason recorded"})`,
    details: {
      credentialRef: ref,
      reasons,
      keys: health.map((entry) => ({
        id: entry.id,
        masked: entry.masked,
        status: entry.status,
        skipReason: entry.skipReason,
        cooldownUntil: entry.cooldownUntil,
      })),
    },
  });
}
export type KeyedRunResult<T> = {
  value: T;
  /** Masked key that signed the call (`****1234`); empty for a keyless endpoint. */
  keyLabel: string;
  keyId: string;
};

/**
 * Runs one provider call with automatic key rotation: the healthiest key signs it, and a
 * 401/403/429 or a 5xx moves the call to the next key. Every outcome is written back, so
 * the next call starts from what this one learned.
 *
 * `allowKeyless` covers endpoints that need no key at all (local models, cookie-based
 * gateways). A credential that exists but is entirely unusable stays an error - the user
 * pasted keys precisely because that endpoint requires them.
 */
export async function runWithCredentialKey<T>(
  input: {
    ref: string;
    providerId: string;
    force?: boolean;
    allowKeyless?: boolean;
    /** Called before the pool rotates away from a key that just failed. */
    onKeyFailure?: (info: { keyLabel: string; keyId: string; error: unknown }) => void;
  },
  run: (secret: string | null) => Promise<T>,
): Promise<KeyedRunResult<T>> {
  const plan = await planCredentialKeys(input);
  if (plan.selections.length === 0) {
    if (plan.health.length === 0) {
      if (input.allowKeyless) {
        return { value: await run(null), keyLabel: "", keyId: "" };
      }
      throw new AppError("MODEL_CREDENTIAL_MISSING", {
        status: 400,
        message: `No credential key is configured for ${input.ref}`,
        details: { credentialRef: input.ref, providerId: input.providerId },
      });
    }
    throw unavailableError(input.ref, plan.health);
  }

  let lastError: unknown = null;
  for (const selection of plan.selections) {
    try {
      await markCredentialKeyUsed(selection.keyId);
      const value = await run(selection.secret);
      await markCredentialKeySuccess(selection.keyId);
      return { value, keyLabel: selection.masked, keyId: selection.keyId };
    } catch (error) {
      lastError = error;
      await reportCredentialKeyFailure(selection, error);
      if (!diagnoseCredentialFailure(error).retryWithAnotherKey) {
        throw error;
      }
      input.onKeyFailure?.({ keyLabel: selection.masked, keyId: selection.keyId, error });
    }
  }

  throw lastError ?? unavailableError(input.ref, plan.health);
}

/** Writes one outcome back to a specific key (used when the caller owns the loop). */
export async function reportCredentialKeyFailure(selection: { keyId: string }, error: unknown) {
  const diagnosis = diagnoseCredentialFailure(error);
  await markCredentialKeyFailure({
    id: selection.keyId,
    status: diagnosis.status,
    cooldownUntil: diagnosis.cooldownMs ? Date.now() + diagnosis.cooldownMs : null,
    countError: diagnosis.isKeyFault,
  });
}

/** A probe or a successful catalog list is a health statement about the key that ran it. */
export async function reportCredentialKeySuccess(keyId: string) {
  if (!keyId) return;
  await markCredentialKeySuccess(keyId);
}

/** Manual lifecycle (§5.4): clear a cooldown / failure and put the key back in rotation. */
export async function resetCredentialKey(keyId: string) {
  await setCredentialKeyStatus(keyId, "unknown", null);
}

/** Manual lifecycle: take a key out of rotation, or put it back. */
export async function setCredentialKeyEnabled(keyId: string, enabled: boolean) {
  await setCredentialKeyStatus(keyId, enabled ? "unknown" : "disabled", null);
}

/** The credential is gone: its health rows must not outlive it. */
export async function forgetCredentialKeys(ref: string) {
  const records = await listCredentialKeys(ref);
  if (records.length > 0) {
    await deleteCredentialKeys(records.map((record) => record.id));
  }
}
