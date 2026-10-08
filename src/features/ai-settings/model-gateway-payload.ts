/**
 * Pure helpers shared by the CLI importer (`scripts/import-gateway-models.ts`) and
 * the in-app manual sync in `model-gateway-sync.ts`. They deliberately avoid DB and
 * network imports so both paths can reuse them and they stay unit-testable.
 */

/**
 * Reads the model ids out of a gateway response body, accepting either
 * `{"data":["model-a"]}` or a bare `["model-a"]` array. Ids are trimmed and
 * de-duplicated; non-string entries are dropped.
 */
export function parseGatewayModelPayload(payload: unknown): string[] {
  const container = payload as { data?: unknown } | null | undefined;
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.data)
      ? (container?.data as unknown[])
      : [];

  return Array.from(
    new Set(
      rawModels
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    ),
  );
}

/** Human readable label for an endpoint, e.g. `quanzil.com/api/user/models`. */
export function gatewayEndpointLabel(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return endpoint.trim();
  }
}

/** Local calendar date (yyyy-mm-dd) of the machine that ran the sync. */
export function formatGatewaySyncDate(value: number) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
