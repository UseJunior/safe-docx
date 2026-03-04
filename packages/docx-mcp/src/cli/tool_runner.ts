/**
 * Thin wrapper: creates SessionManager, calls dispatchToolCall, handles output routing.
 */
import { SessionManager } from '../session/manager.js';
import { dispatchToolCall } from '../server.js';

export interface ToolRunnerIO {
  write: (line: string) => void;
  writeError: (line: string) => void;
}

export async function runToolCommand(
  toolName: string,
  args: Record<string, unknown>,
  opts: ToolRunnerIO,
): Promise<void> {
  const mgr = new SessionManager();
  const result = await dispatchToolCall(mgr, toolName, args);

  const json = JSON.stringify(result, null, 2);
  const success = (result as { success?: boolean }).success;

  if (success === false) {
    opts.writeError(json);
    throw new Error(`Tool "${toolName}" failed`);
  }

  opts.write(json);
}
