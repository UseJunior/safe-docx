/**
 * Thin wrapper: creates SessionManager, calls dispatchToolCall, handles output routing.
 */
import { SessionManager } from '../session/manager.js';
import { dispatchToolCall } from '../server.js';

export interface ToolRunnerIO {
  write: (line: string) => void;
  writeError: (line: string) => void;
}

/**
 * Resolve the AI author for tracked-change emission from SAFE_DOCX_AI_AUTHOR.
 * Empty string disables tracked emission (legacy behavior); unset defaults to 'SafeDocX'.
 * Symmetric with the resolution in server.ts.
 */
export function resolveCliAiAuthor(): string | null {
  const env = process.env.SAFE_DOCX_AI_AUTHOR;
  return env === '' ? null : (env ?? 'SafeDocX');
}

export async function runToolCommand(
  toolName: string,
  args: Record<string, unknown>,
  opts: ToolRunnerIO,
): Promise<void> {
  const mgr = new SessionManager({ defaultAiAuthor: resolveCliAiAuthor() });
  const result = await dispatchToolCall(mgr, toolName, args);

  const json = JSON.stringify(result, null, 2);
  const success = (result as { success?: boolean }).success;

  if (success === false) {
    opts.writeError(json);
    throw new Error(`Tool "${toolName}" failed`);
  }

  opts.write(json);
}
