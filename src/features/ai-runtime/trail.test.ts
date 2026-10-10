import { describe, expect, it } from "vitest";
import { AppError, toApiErrorShape } from "@/lib/app-errors";
import type { ModelAttempt } from "./contracts";
import { attachModelAttempts, modelAttemptsFrom } from "./trail";

/**
 * The trail an error carries (CI-P7-01-04 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `chat()` knows exactly which requests it sent when it gives up, and a failed request is one the
 * provider may still have billed for. This module is how that knowledge survives the throw without
 * the runtime importing anything that stores data, so what is pinned here is the mechanics:
 *
 * - the trail reads back, in order, after the error has travelled;
 * - it is *not* part of the error's API surface - `toApiErrorShape` publishes `code`/`message`/
 *   `details`, and a ledger trail must not become something a client sees;
 * - an empty trail is not attached, so "nothing was sent" stays distinguishable from "everything
 *   failed" (that difference is what tells an unconfigured install apart from a broken one);
 * - a thrown non-object, or an unrelated object, yields no trail instead of an exception.
 */

function attempt(over: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    kind: "answer",
    outcome: "failed",
    providerId: "qwen",
    modelId: "qwen3-max",
    endpointId: "qwen-default",
    credentialLabel: "****1234",
    error: "HTTP 502",
    ...over,
  };
}

function failure(details?: unknown) {
  return new AppError("MODEL_UPSTREAM_FAILED", { status: 502, message: "boom", details });
}

describe("model call trail", () => {
  it("reads back in order after the error has travelled", () => {
    const attached = attachModelAttempts(failure(), [
      attempt({ credentialLabel: "****1234" }),
      attempt({ credentialLabel: "****5678", kind: "self-correction" }),
    ]);

    expect(modelAttemptsFrom(attached).map((entry) => entry.credentialLabel)).toEqual(["****1234", "****5678"]);
    expect(modelAttemptsFrom(attached).map((entry) => entry.kind)).toEqual(["answer", "self-correction"]);
  });

  it("returns the error it was given, so a throw site stays one expression", () => {
    const error = failure();

    expect(attachModelAttempts(error, [attempt()])).toBe(error);
  });

  it("stays out of the error's API surface", () => {
    const attached = attachModelAttempts(failure({ reason: "capability-missing" }), [attempt()]);

    const shape = toApiErrorShape(attached);
    expect(shape).toMatchObject({ code: "MODEL_UPSTREAM_FAILED", message: "boom", details: { reason: "capability-missing" } });
    // The trail is bookkeeping, not a contract with whoever reads the HTTP response.
    expect(JSON.stringify(shape)).not.toContain("****1234");
  });

  it("attaches nothing when no request was sent", () => {
    const attached = attachModelAttempts(failure(), []);

    expect(modelAttemptsFrom(attached)).toEqual([]);
  });

  it("ignores a thrown value that is not an object", () => {
    expect(modelAttemptsFrom("boom")).toEqual([]);
    expect(modelAttemptsFrom(undefined)).toEqual([]);
    expect(modelAttemptsFrom(null)).toEqual([]);
    expect(attachModelAttempts("boom", [attempt()])).toBe("boom");
  });

  it("does not read a trail off an unrelated object, or trust a foreign value", () => {
    expect(modelAttemptsFrom({ message: "boom" })).toEqual([]);
    expect(modelAttemptsFrom({ coolpilotModelAttempts: "not a trail" })).toEqual([]);
  });
});
