import type { ValidationIssue } from './types.js';

export class DocxMarkdocError extends Error {
  readonly code: string;
  readonly issues?: ValidationIssue[];
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DocxMarkdocError';
    this.code = code;
    this.details = details;
    this.issues = Array.isArray(details) ? details as ValidationIssue[] : undefined;
  }
}

/**
 * A command line the CLI cannot run: an unknown command or option, a missing
 * or extra argument, or flags that cannot be combined. The CLI prints it as
 * one `ERROR CLI_USAGE: …` line that names the command's `--help`, never as a
 * stack trace. `command` is the subcommand whose help applies, when known.
 */
export class CliUsageError extends DocxMarkdocError {
  command?: string;

  constructor(message: string, command?: string) {
    super('CLI_USAGE', message);
    this.name = 'CliUsageError';
    if (command !== undefined) this.command = command;
  }
}
