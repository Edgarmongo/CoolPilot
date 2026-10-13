export const appErrorCodes = [
  "UNKNOWN_ERROR",
  "INVALID_JSON",
  "INVALID_PAYLOAD",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "AI_PROVIDER_MISSING_KEY",
  "AI_PROVIDER_NO_TEXT",
  "AI_PROVIDER_FAILED",
  "AI_STRUCTURED_OUTPUT_INVALID",
  "MODEL_GATEWAY_DISABLED",
  "MODEL_GATEWAY_MISSING_COOKIE",
  "MODEL_GATEWAY_REQUEST_FAILED",
  "MODEL_GATEWAY_EMPTY_RESPONSE",
  "MODEL_PROVIDER_NOT_FOUND",
  "MODEL_ENDPOINT_INVALID",
  "MODEL_PROTOCOL_UNSUPPORTED",
  "MODEL_CREDENTIAL_MISSING",
  "MODEL_CREDENTIAL_UNAVAILABLE",
  "MODEL_CREDENTIAL_INVALID",
  "MODEL_CREDENTIAL_FORBIDDEN",
  "MODEL_RATE_LIMITED",
  "MODEL_CAPABILITY_UNAVAILABLE",
  "MODEL_NOT_CONFIGURED",
  "MODEL_SYNC_FAILED",
  "MODEL_PROBE_FAILED",
  "MODEL_UPSTREAM_FAILED",
  "MODEL_UPSTREAM_NO_CONTENT",
  /**
   * CI-EMB-01: an embedding exchange that is not usable as one - a request carrying no text, an answer
   * whose vectors are the wrong count, not numbers, or not all the same length. It is deliberately one
   * code for both sides: a caller reading it knows the *vectors* are the problem, and the message says
   * which of the two ends it came from.
   */
  "MODEL_EMBEDDING_INVALID",
  "UNSUPPORTED_VIDEO",
  "VIDEO_TOO_LARGE",
  "PUBLISH_RUN_FAILED",
  /** CI-P7-01-05: the price catalog refused a row that does not describe a priceable dimension. */
  "AI_PRICE_INVALID",
  /** CI-P7-01-05: that provider+model+meter+instant already has a price in force. */
  "AI_PRICE_CONFLICT",
  /** CI-P7-03: the budget policy refused this call, so no request was sent at all. */
  "AI_BUDGET_EXCEEDED",
  /**
   * CI-LEAD-01: the lead already recorded a deal, and the write would move it out of 已成交. It is a
   * refusal rather than a silent trim, so no write deletes an amount or a closing date by accident.
   */
  "LEAD_DEAL_RECORDED",
  /** CI-LEAD-01: an amount arrived without a currency. A number with no unit is not an amount. */
  "LEAD_DEAL_CURRENCY_MISSING",
] as const;

export type AppErrorCode = (typeof appErrorCodes)[number];

export type ApiErrorShape = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
};

const fallbackMessages: Record<AppErrorCode, string> = {
  UNKNOWN_ERROR: "Unknown error",
  INVALID_JSON: "Invalid JSON body",
  INVALID_PAYLOAD: "Invalid payload",
  NOT_FOUND: "Not found",
  UNAUTHORIZED: "Unauthorized",
  AI_PROVIDER_MISSING_KEY: "Missing AI provider API key",
  AI_PROVIDER_NO_TEXT: "AI provider returned no text",
  AI_PROVIDER_FAILED: "AI provider request failed",
  AI_STRUCTURED_OUTPUT_INVALID: "AI provider returned invalid structured output",
  MODEL_GATEWAY_DISABLED: "Model gateway sync is disabled",
  MODEL_GATEWAY_MISSING_COOKIE: "Model gateway session cookie is missing",
  MODEL_GATEWAY_REQUEST_FAILED: "Model gateway request failed",
  MODEL_GATEWAY_EMPTY_RESPONSE: "Model gateway returned no models",
  MODEL_PROVIDER_NOT_FOUND: "Unknown model provider",
  MODEL_ENDPOINT_INVALID: "Model endpoint is not usable",
  MODEL_PROTOCOL_UNSUPPORTED: "No adapter implements this protocol yet",
  MODEL_CREDENTIAL_MISSING: "No credential is stored for this model endpoint",
  MODEL_CREDENTIAL_UNAVAILABLE: "Every stored credential key is unavailable (cooling down or rejected)",
  MODEL_CREDENTIAL_INVALID: "The provider rejected this API key",
  MODEL_CREDENTIAL_FORBIDDEN: "The provider refused this API key (permission or region)",
  MODEL_RATE_LIMITED: "The provider rate-limited this API key",
  MODEL_CAPABILITY_UNAVAILABLE: "No usable model provides the required capability",
  MODEL_NOT_CONFIGURED: "No model is configured for this capability",
  MODEL_SYNC_FAILED: "Model catalog sync failed",
  MODEL_PROBE_FAILED: "Capability probe failed",
  MODEL_UPSTREAM_FAILED: "Model provider request failed",
  MODEL_UPSTREAM_NO_CONTENT: "Model provider returned no content",
  MODEL_EMBEDDING_INVALID: "The embedding request or response is not a usable vector exchange",
  UNSUPPORTED_VIDEO: "Unsupported video format",
  VIDEO_TOO_LARGE: "Video exceeds the size limit",
  PUBLISH_RUN_FAILED: "The publish batch ended with unhandled account failures",
  AI_PRICE_INVALID: "This is not a price a ledger row could be costed with",
  AI_PRICE_CONFLICT: "A price for this provider, model and dimension is already in force from that instant",
  AI_BUDGET_EXCEEDED: "The AI budget policy refused this call before it was sent",
  LEAD_DEAL_RECORDED:
    "This lead already recorded a deal; clear it in the same write to move it out of 已成交",
  LEAD_DEAL_CURRENCY_MISSING: "An amount must carry its currency",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, options: { message?: string; status?: number; details?: unknown } = {}) {
    super(options.message ?? fallbackMessages[code]);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

export function isAppErrorCode(value: string): value is AppErrorCode {
  return appErrorCodes.includes(value as AppErrorCode);
}

export function toApiErrorShape(error: unknown, fallbackCode: AppErrorCode = "UNKNOWN_ERROR"): ApiErrorShape {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message || fallbackMessages[fallbackCode],
    };
  }

  return {
    code: fallbackCode,
    message: fallbackMessages[fallbackCode],
    details: error,
  };
}

export function appErrorMessage(code: AppErrorCode) {
  return fallbackMessages[code];
}
