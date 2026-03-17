/** MCP error codes for Google Docs operations */
export type GoogleDocsMcpErrorCode =
  | 'RATE_LIMIT'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'REVISION_CONFLICT'
  | 'SERVER_ERROR'
  | 'UNSUPPORTED_FOR_PROVIDER'
  | 'AUTH_ERROR'
  | 'ANCHOR_NOT_FOUND'
  | 'TEXT_NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'EDIT_ERROR'
  | 'SESSION_STALE';

/** Whether an error is retriable */
export type RetryStrategy = {
  retriable: boolean;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  useJitter: boolean;
};

/** Error mapping entry */
export type ErrorMapping = {
  httpCode: number;
  mcpCode: GoogleDocsMcpErrorCode;
  retry: RetryStrategy;
  sessionAction: 'valid' | 'invalidated' | 'cache_invalidated' | 'degraded';
};

/** Google API error to MCP error mapping */
export const ERROR_MAP: Record<number, ErrorMapping> = {
  429: {
    httpCode: 429,
    mcpCode: 'RATE_LIMIT',
    retry: { retriable: true, baseDelayMs: 1000, maxDelayMs: 60000, maxRetries: 5, useJitter: true },
    sessionAction: 'valid',
  },
  403: {
    httpCode: 403,
    mcpCode: 'PERMISSION_DENIED',
    retry: { retriable: false, baseDelayMs: 0, maxDelayMs: 0, maxRetries: 0, useJitter: false },
    sessionAction: 'invalidated',
  },
  404: {
    httpCode: 404,
    mcpCode: 'NOT_FOUND',
    retry: { retriable: false, baseDelayMs: 0, maxDelayMs: 0, maxRetries: 0, useJitter: false },
    sessionAction: 'invalidated',
  },
  400: {
    httpCode: 400,
    mcpCode: 'INVALID_REQUEST',
    retry: { retriable: false, baseDelayMs: 0, maxDelayMs: 0, maxRetries: 0, useJitter: false },
    sessionAction: 'valid',
  },
  409: {
    httpCode: 409,
    mcpCode: 'REVISION_CONFLICT',
    retry: { retriable: true, baseDelayMs: 500, maxDelayMs: 5000, maxRetries: 3, useJitter: true },
    sessionAction: 'cache_invalidated',
  },
  500: {
    httpCode: 500,
    mcpCode: 'SERVER_ERROR',
    retry: { retriable: true, baseDelayMs: 2000, maxDelayMs: 120000, maxRetries: 3, useJitter: true },
    sessionAction: 'valid',
  },
  503: {
    httpCode: 503,
    mcpCode: 'SERVER_ERROR',
    retry: { retriable: true, baseDelayMs: 2000, maxDelayMs: 120000, maxRetries: 3, useJitter: true },
    sessionAction: 'valid',
  },
};

/** Map a Google API error to an MCP error */
export function mapGoogleError(error: unknown): { code: GoogleDocsMcpErrorCode; message: string; hint?: string; mapping: ErrorMapping | null } {
  const httpCode = extractHttpCode(error);
  const message = extractErrorMessage(error);

  if (httpCode && ERROR_MAP[httpCode]) {
    const mapping = ERROR_MAP[httpCode]!;
    const hints: Record<string, string> = {
      RATE_LIMIT: 'Rate limit exceeded. The request will be retried automatically.',
      PERMISSION_DENIED: 'Check that the service account has access to the document and required scopes (documents + drive.file).',
      NOT_FOUND: 'Document not found. Verify the document ID and that it is shared with the service account.',
      REVISION_CONFLICT: 'Document was modified by another user. Re-fetching and retrying.',
      SERVER_ERROR: 'Google API server error. Retrying with backoff.',
    };
    return {
      code: mapping.mcpCode,
      message,
      hint: hints[mapping.mcpCode],
      mapping,
    };
  }

  return { code: 'EDIT_ERROR', message, mapping: null };
}

/** Extract HTTP status code from a Google API error */
function extractHttpCode(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.code === 'number') return e.code;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (typeof resp.status === 'number') return resp.status;
    }
  }
  return null;
}

/** Extract error message from a Google API error */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/** Calculate delay for exponential backoff with jitter */
export function calculateBackoffDelay(attempt: number, strategy: RetryStrategy): number {
  const exponentialDelay = Math.min(
    strategy.baseDelayMs * Math.pow(2, attempt),
    strategy.maxDelayMs,
  );
  if (strategy.useJitter) {
    return exponentialDelay * (0.5 + Math.random() * 0.5);
  }
  return exponentialDelay;
}

/** Sleep for a given number of milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract Retry-After header value in milliseconds from a GoogleApiError.
 * Returns null if not present or not parseable.
 */
function extractRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  const response = e.response as Record<string, unknown> | undefined;
  if (!response) return null;

  // Support both Headers object and plain object
  const headers = response.headers;
  let retryAfter: string | null = null;

  if (headers && typeof (headers as Headers).get === 'function') {
    retryAfter = (headers as Headers).get('retry-after');
  }

  if (!retryAfter) return null;

  // Retry-After can be seconds (integer) or HTTP-date
  const seconds = Number(retryAfter);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const dateMs = Date.parse(retryAfter);
  if (!isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/** Execute a function with retry logic, honoring per-status maxRetries and Retry-After */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    onRetry?: (attempt: number, error: unknown) => void;
    /** @internal Injectable sleep for testing */
    _sleepFn?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const defaultMaxRetries = options?.maxRetries ?? 3;
  const sleepFn = options?._sleepFn ?? sleep;
  let lastError: unknown;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const mapped = mapGoogleError(error);

      // Use per-status maxRetries from ERROR_MAP, falling back to the provided/default
      const effectiveMaxRetries = mapped.mapping?.retry.retriable
        ? mapped.mapping.retry.maxRetries
        : defaultMaxRetries;

      if (!mapped.mapping?.retry.retriable || attempt >= effectiveMaxRetries) {
        throw error;
      }

      // Calculate backoff delay, using Retry-After as floor if present
      let delay = calculateBackoffDelay(attempt, mapped.mapping.retry);
      const retryAfterMs = extractRetryAfterMs(error);
      if (retryAfterMs != null && retryAfterMs > delay) {
        delay = Math.min(retryAfterMs, mapped.mapping.retry.maxDelayMs);
      }

      options?.onRetry?.(attempt, error);
      await sleepFn(delay);
    }
  }

  throw lastError;
}
