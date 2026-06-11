/**
 * Typed errors for the generation compiler.
 *
 * GenerationSpecError reports problems in the caller's DocumentSpec (dangling
 * references, unimplemented features, shape violations) with a JSON-pointer-ish
 * path into the spec so callers can surface the exact offending node.
 *
 * GenerationInternalError flags compiler bugs (e.g. an emitter producing a
 * property name missing from its ordering table); it should never be reachable
 * from user input that passed spec validation.
 */

export type GenerationSpecErrorCode =
  | 'empty_sections'
  | 'unsupported_feature'
  | 'dangling_style_reference'
  | 'dangling_numbering_reference'
  | 'invalid_value'
  | 'grid_mismatch';

export class GenerationSpecError extends Error {
  readonly code: GenerationSpecErrorCode;
  /** Path into the spec, e.g. '/sections/0/blocks/2/runs/1'. */
  readonly path: string;

  constructor(code: GenerationSpecErrorCode, path: string, message: string) {
    super(`${message} (at ${path})`);
    this.name = 'GenerationSpecError';
    this.code = code;
    this.path = path;
  }
}

export class GenerationInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationInternalError';
  }
}
