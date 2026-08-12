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
