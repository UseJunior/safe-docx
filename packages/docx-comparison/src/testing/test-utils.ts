/**
 * Type-narrowing assertion guard for test code.
 *
 * Narrows `T | undefined | null` to `T` for TypeScript's control flow,
 * and throws with a clear message if a test assumption is wrong.
 */
export function assertDefined<T>(
  value: T | undefined | null,
  label?: string,
): asserts value is T {
  if (value == null) {
    throw new Error(
      label
        ? `Expected ${label} to be defined, got ${String(value)}`
        : `Expected value to be defined, got ${String(value)}`,
    );
  }
}
