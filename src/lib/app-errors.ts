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
  "UNSUPPORTED_VIDEO",
  "VIDEO_TOO_LARGE",
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
  UNSUPPORTED_VIDEO: "Unsupported video format",
  VIDEO_TOO_LARGE: "Video exceeds the size limit",
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
