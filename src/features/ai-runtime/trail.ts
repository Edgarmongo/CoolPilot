import type { ModelAttempt } from "./contracts";

/**
 * The request trail of a call that never returned (CI-P7-01-04).
 *
 * `chat()` has always known exactly which requests it sent when it gives up; it simply had nowhere
 * to put that knowledge, so a failure threw away its own history - and a failed request is a
 * request the provider may well have billed for. The error carries the trail instead of a database
 * write, which is what keeps the runtime free of storage (see `runtime.ts`).
 *
 * The value is an own property of the error object, not a side table, so it survives the module
 * being loaded twice, stays attached while the error is rethrown or logged, and is still visible
 * to whoever finally reports it. It is deliberately not part of `AppError.details`: that field
 * becomes the HTTP body (`toApiErrorShape`), and the trail is bookkeeping, not an API contract.
 */
const trailProperty = "coolpilotModelAttempts";

type TrailCarrier = { [trailProperty]?: ModelAttempt[] };

/**
 * Attaches `attempts` to a thrown value and returns it, so a throw site stays one expression:
 * `throw attachModelAttempts(error, attempts)`.
 *
 * An empty trail is not attached: it says "no request was sent", and a reader must be able to tell
 * that from "requests were sent and all of them failed". A non-object (a thrown string) is
 * returned untouched.
 */
export function attachModelAttempts<T>(error: T, attempts: ModelAttempt[]): T {
  if (attempts.length > 0 && typeof error === "object" && error !== null) {
    (error as TrailCarrier)[trailProperty] = attempts;
  }
  return error;
}

/** The trail `attachModelAttempts` left on a caught value, or `[]` when there is none. */
export function modelAttemptsFrom(error: unknown): ModelAttempt[] {
  if (typeof error !== "object" || error === null) return [];
  const found = (error as TrailCarrier)[trailProperty];
  return Array.isArray(found) ? found : [];
}