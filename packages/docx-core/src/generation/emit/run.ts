/**
 * Inline-run emitter.
 *
 * PR 1 scope: plain text runs. Run formatting, fields (with their five-part
 * begin/instrText/separate/result/end state machine), tabs, and breaks land
 * in later phases; validate-spec rejects them before emission, so reaching
 * this dispatcher with an unshipped kind is a compiler bug.
 */

import { createWmlElement, createWmlTextElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import { GenerationInternalError } from '../errors.js';
import type { InlineSpec } from '../types.js';

/** Build the w:r element(s) for one inline spec node. */
export function buildInlineRuns(doc: Document, inline: InlineSpec): Element[] {
  if (inline.kind === 'text') {
    const run = createWmlElement(doc, W.r);
    run.appendChild(createWmlTextElement(doc, inline.text));
    return [run];
  }
  throw new GenerationInternalError(
    `Inline kind '${inline.kind}' reached the run emitter without a shipped emitter; ` +
      'validate-spec should have rejected it',
  );
}
