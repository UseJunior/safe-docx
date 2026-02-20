export type ToolResponse =
  | { success: true; [key: string]: unknown }
  | { success: false; error: { code: string; message: string; hint?: string } };

export function ok(extra: Record<string, unknown> = {}): ToolResponse {
  return { success: true, ...extra };
}

export function err(code: string, message: string, hint?: string): ToolResponse {
  return { success: false, error: { code, message, hint } };
}
