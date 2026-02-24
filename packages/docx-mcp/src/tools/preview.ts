export const ERROR_PREVIEW_CHARS = 50;
export const RESULT_PREVIEW_CHARS = 5000;
export const READ_SIMPLE_PREVIEW_CHARS = 5000;

export function previewText(text: string, maxChars: number, suffix = '...'): string {
  if (maxChars < 0) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}${suffix}`;
}
