/**
 * Shared parsing utilities for the CLI layer.
 */

export function parseBoolean(raw: string, flagName: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid value for ${flagName}: ${raw}. Use true or false.`);
}

export function toSnakeCase(kebab: string): string {
  return kebab.replace(/-/g, '_');
}

export function toKebabCase(snake: string): string {
  return snake.replace(/_/g, '-');
}
