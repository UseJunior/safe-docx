/**
 * Thin wrapper: creates SessionManager, calls dispatchToolCall, handles output routing.
 */
import { SessionManager } from '../session/manager.js';
import { dispatchToolCall } from '../server.js';
import { toKebabCase } from './parse_utils.js';
import type { CliSaveFormat } from './output_option.js';

export interface ToolRunnerIO {
  write: (line: string) => void;
  writeError: (line: string) => void;
}

/**
 * A command failure whose structured error has already been written to
 * stderr. The CLI entry points print only its message, never a stack trace,
 * so a refused document surfaces as one JSON error object (#1025).
 */
export class CliCommandFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliCommandFailure';
  }
}

/** Error code for a CLI command that would exit with its edits unsaved (#1048). */
export const UNSAVED_EDITS_DISCARDED = 'UNSAVED_EDITS_DISCARDED';

/**
 * Resolve the AI author for tracked-change emission from SAFE_DOCX_AI_AUTHOR.
 * Empty string disables tracked emission (legacy behavior); unset defaults to 'SafeDocX'.
 * Symmetric with the resolution in server.ts.
 */
export function resolveCliAiAuthor(): string | null {
  const env = process.env.SAFE_DOCX_AI_AUTHOR;
  return env === '' ? null : (env ?? 'SafeDocX');
}

/**
 * Edits held only in memory by local (DOCX, ODT) sessions. Google Docs edits
 * are applied to the remote document as they are made, so a Google Docs
 * session never holds a discardable edit.
 */
function unsavedEditCount(mgr: SessionManager): number {
  return mgr
    .listSessions()
    .filter((s) => s.provider !== 'gdocs')
    .reduce((sum, s) => sum + s.editCount, 0);
}

export interface FinishCommandOptions {
  /** CLI command name as typed, e.g. `replace-text` or `edit`. */
  command: string;
  /** Tool arguments; `file_path` / `google_doc_id` identify the document to save. */
  args: Record<string, unknown>;
  /** The successful tool response. */
  result: unknown;
  /** `-o/--output` value, when given. */
  outputPath?: string;
  /** `--save-format` value, passed to the save when given. */
  saveFormat?: CliSaveFormat;
}

/**
 * End a one-shot CLI command whose tool call succeeded. With an output path,
 * save the session there. Without one, refuse to report success if the
 * command made an edit that would be discarded when the process exits (#1048):
 * print `success:false` with UNSAVED_EDITS_DISCARDED and throw, so the exit
 * code is non-zero. A command that made no edit prints its result unchanged.
 */
export async function finishCliCommand(
  mgr: SessionManager,
  opts: FinishCommandOptions,
  io: ToolRunnerIO,
): Promise<void> {
  const { command, args, result, outputPath, saveFormat } = opts;

  if (outputPath !== undefined) {
    const saveArgs: Record<string, unknown> = { save_to_local_path: outputPath };
    if (args.file_path !== undefined) saveArgs.file_path = args.file_path;
    if (args.google_doc_id !== undefined) saveArgs.google_doc_id = args.google_doc_id;
    if (saveFormat !== undefined) saveArgs.save_format = saveFormat;
    const saveResult = await dispatchToolCall(mgr, 'save', saveArgs);
    if ((saveResult as { success?: boolean }).success === false) {
      // Print only the save error: the tool's own response says
      // `success: true`, but its edit was not written.
      io.writeError(JSON.stringify(saveResult, null, 2));
      throw new CliCommandFailure(`${command}: saving to ${outputPath} failed; the edit was not written`);
    }
    io.write(JSON.stringify({ success: true, apply: result, save: saveResult }, null, 2));
    return;
  }

  const edits = unsavedEditCount(mgr);
  if (edits > 0) {
    const target = typeof args.file_path === 'string' ? args.file_path : 'the input file';
    // The tool's own response is not echoed: it (and, for batch_edit, each
    // step result) says `success: true`, which must never appear for an edit
    // that was thrown away.
    const refusal = {
      success: false,
      error: {
        code: UNSAVED_EDITS_DISCARDED,
        message:
          `${command} applied ${edits} edit${edits === 1 ? '' : 's'} in memory, but the CLI keeps no session ` +
          `between commands, so the edit was discarded and ${target} was not changed.`,
        hint:
          `Re-run with -o/--output <path> to write the edited document: safe-docx ${command} <file> ... --output <path>.` +
          (command === 'edit'
            ? ''
            : ' To apply several edits in one run, use safe-docx edit <file> --replace ... --output <path>.'),
      },
    };
    io.writeError(JSON.stringify(refusal, null, 2));
    throw new CliCommandFailure(`${command}: edit discarded; re-run with --output <path> to save it`);
  }

  io.write(JSON.stringify(result, null, 2));
}

export async function runToolCommand(
  toolName: string,
  args: Record<string, unknown>,
  opts: ToolRunnerIO,
  output: { outputPath?: string; saveFormat?: CliSaveFormat } = {},
): Promise<void> {
  const mgr = new SessionManager({ defaultAiAuthor: resolveCliAiAuthor() });
  const result = await dispatchToolCall(mgr, toolName, args);

  const success = (result as { success?: boolean }).success;

  if (success === false) {
    opts.writeError(JSON.stringify(result, null, 2));
    throw new CliCommandFailure(`Tool "${toolName}" failed`);
  }

  await finishCliCommand(mgr, { command: toKebabCase(toolName), args, result, ...output }, opts);
}
