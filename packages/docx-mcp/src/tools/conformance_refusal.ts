import { errorCode, errorMessage } from '../error_utils.js';
import { err, type ToolResponse } from './types.js';

/** Error code docx-core raises when a package is WML Strict (ISO/IEC 29500 Strict). */
export const UNSUPPORTED_CONFORMANCE_CLASS = 'UNSUPPORTED_CONFORMANCE_CLASS';

/**
 * Map docx-core's `UnsupportedConformanceClassError` to the structured tool
 * error shape, so the refusal reaches an agent as `error.code`
 * `UNSUPPORTED_CONFORMANCE_CLASS` with the document-level message and hint
 * instead of a generic read failure or a raw stack (#1025).
 *
 * Returns `null` for any other error so callers keep their existing handling.
 */
export function conformanceRefusalResponse(error: unknown): ToolResponse | null {
  if (errorCode(error) !== UNSUPPORTED_CONFORMANCE_CLASS) return null;
  const hint = (error as { hint?: unknown }).hint;
  return err(
    UNSUPPORTED_CONFORMANCE_CLASS,
    errorMessage(error),
    typeof hint === 'string' ? hint : undefined,
  );
}
