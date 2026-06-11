/**
 * Inline-run emitter.
 *
 * Shipped: text runs with full RunProps formatting, tab and break runs, and
 * complete five-part complex fields. A FieldSpec compiles to
 * begin → instruction text → separate → cached result → end so reading
 * applications always display a value without recomputation prompts — the
 * required `cachedResult` makes the no-recovery-dialog property
 * unrepresentable-by-omission. `w:dirty` is never set (it triggers
 * update-fields prompts in some readers).
 */

import { createWmlElement, createWmlTextElement } from '../../primitives/dom-helpers.js';
import { W } from '../../primitives/namespaces.js';
import { GenerationInternalError } from '../errors.js';
import type { FieldSpec, InlineSpec, RunProps } from '../types.js';
import { buildRunPropsElement } from './properties.js';

/** Instruction text per field, with the canonical surrounding spaces. */
const FIELD_INSTRUCTION_TEXT: Record<FieldSpec['field'], string> = {
  PAGE: ' PAGE ',
  NUMPAGES: ' NUMPAGES ',
};

function makeRun(doc: Document, props: RunProps, ...children: Element[]): Element {
  const run = createWmlElement(doc, W.r);
  const rPr = buildRunPropsElement(doc, props);
  if (rPr) run.appendChild(rPr);
  for (const child of children) run.appendChild(child);
  return run;
}

/**
 * Five sibling runs per field: fldChar begin, preserved-space instruction
 * text, fldChar separate, the cached result, fldChar end.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
function buildFieldRuns(doc: Document, field: FieldSpec): Element[] {
  const instr = createWmlElement(doc, W.instrText);
  instr.setAttribute('xml:space', 'preserve');
  instr.appendChild(doc.createTextNode(FIELD_INSTRUCTION_TEXT[field.field]));

  return [
    makeRun(doc, field, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'begin' })),
    makeRun(doc, field, instr),
    makeRun(doc, field, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'separate' })),
    makeRun(doc, field, createWmlTextElement(doc, field.cachedResult)),
    makeRun(doc, field, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'end' })),
  ];
}

/** Build the w:r element(s) for one inline spec node. */
export function buildInlineRuns(doc: Document, inline: InlineSpec): Element[] {
  switch (inline.kind) {
    case 'text': {
      const run = createWmlElement(doc, W.r);
      const rPr = buildRunPropsElement(doc, inline);
      if (rPr) run.appendChild(rPr);
      run.appendChild(createWmlTextElement(doc, inline.text));
      return [run];
    }
    case 'field':
      return buildFieldRuns(doc, inline);
    case 'tab':
      return [makeRun(doc, {}, createWmlElement(doc, W.tab))];
    case 'break': {
      const attrs = inline.breakType === 'page' ? { 'w:type': 'page' } : undefined;
      return [makeRun(doc, {}, createWmlElement(doc, W.br, attrs))];
    }
    default:
      throw new GenerationInternalError(
        `Inline kind '${(inline as { kind: string }).kind}' reached the run emitter without a shipped emitter`,
      );
  }
}
