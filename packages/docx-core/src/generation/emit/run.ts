/**
 * Inline-run emitter.
 *
 * Shipped: text runs with full RunProps formatting, tab and break runs,
 * footnote reference runs, cross-reference (REF) fields, and complete
 * five-part complex fields. A FieldSpec compiles to
 * begin → instruction text → separate → cached result → end so reading
 * applications always display a value without recomputation prompts — the
 * required `cachedResult` makes the no-recovery-dialog property
 * unrepresentable-by-omission. `w:dirty` is never set (it triggers
 * update-fields prompts in some readers).
 */

import { createWmlElement, createWmlTextElement } from '../../primitives/dom-helpers.js';
import { buildFootnoteReferenceRun } from '../../primitives/footnote-shapes.js';
import { W } from '../../primitives/namespaces.js';
import { GenerationInternalError } from '../errors.js';
import type { CrossReferenceSpec, FieldSpec, InlineSpec, RunProps } from '../types.js';
import type { BlockEmitContext } from './emit-context.js';
import { buildRunPropsElement } from './properties.js';

/**
 * Instruction text per supported field, with canonical surrounding spaces.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.44
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.42
 */
const FIELD_INSTRUCTION_TEXT: Record<FieldSpec['field'], string> = {
  PAGE: ' PAGE ',
  NUMPAGES: ' NUMPAGES ',
};

function makeRun(doc: Document, props: RunProps, ctx: BlockEmitContext | undefined, ...children: Element[]): Element {
  const run = createWmlElement(doc, W.r);
  const rPr = buildRunPropsElement(doc, props, { themeColorValues: ctx?.themeColorValues });
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
function buildFieldRuns(doc: Document, field: FieldSpec, ctx?: BlockEmitContext): Element[] {
  const instr = createWmlElement(doc, W.instrText);
  instr.setAttribute('xml:space', 'preserve');
  instr.appendChild(doc.createTextNode(FIELD_INSTRUCTION_TEXT[field.field]));

  return [
    makeRun(doc, field, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'begin' })),
    makeRun(doc, field, ctx, instr),
    makeRun(doc, field, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'separate' })),
    makeRun(doc, field, ctx, createWmlTextElement(doc, field.cachedResult)),
    makeRun(doc, field, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'end' })),
  ];
}

/**
 * A cross-reference: the same five-run complex field over a `REF` instruction
 * naming the target bookmark, `\w` (full-context number) or `\n` (paragraph
 * number), and `\h` so the result is a hyperlink to the bookmark. The
 * result run is filled by the resolver with the number Word shows after
 * updating fields.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
function buildCrossReferenceRuns(doc: Document, reference: CrossReferenceSpec, ctx?: BlockEmitContext): Element[] {
  if (!ctx?.crossReferences) {
    throw new GenerationInternalError('A cross-reference reached the run emitter in a story that cannot carry one');
  }
  const { kind: _kind, bookmark, number = 'fullContext', ...props } = reference;
  void _kind;
  const instr = createWmlElement(doc, W.instrText);
  instr.setAttribute('xml:space', 'preserve');
  instr.appendChild(doc.createTextNode(` REF ${bookmark} ${number === 'paragraph' ? '\\n' : '\\w'} \\h `));
  const result = makeRun(doc, props, ctx);
  ctx.crossReferences.fill(result, bookmark, number);
  return [
    makeRun(doc, props, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'begin' })),
    makeRun(doc, props, ctx, instr),
    makeRun(doc, props, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'separate' })),
    result,
    makeRun(doc, props, ctx, createWmlElement(doc, W.fldChar, { 'w:fldCharType': 'end' })),
  ];
}

/** Build the w:r element(s) for one inline spec node. */
export function buildInlineRuns(doc: Document, inline: InlineSpec, ctx?: BlockEmitContext): Element[] {
  switch (inline.kind) {
    case 'text': {
      const run = createWmlElement(doc, W.r);
      const rPr = buildRunPropsElement(doc, inline, { themeColorValues: ctx?.themeColorValues });
      if (rPr) run.appendChild(rPr);
      run.appendChild(createWmlTextElement(doc, inline.text));
      return [run];
    }
    case 'field':
      return buildFieldRuns(doc, inline, ctx);
    case 'crossReference':
      return buildCrossReferenceRuns(doc, inline, ctx);
    case 'tab':
      return [makeRun(doc, {}, ctx, createWmlElement(doc, W.tab))];
    case 'break': {
      const attrs = inline.breakType === 'page' ? { 'w:type': 'page' } : undefined;
      return [makeRun(doc, {}, ctx, createWmlElement(doc, W.br, attrs))];
    }
    case 'footnote': {
      // The note body is collected here and emitted to word/footnotes.xml
      // once the body story is complete; the reference mark stays inline.
      if (!ctx?.footnotes) {
        throw new GenerationInternalError('A footnote reached the run emitter in a story that cannot carry footnotes');
      }
      return [buildFootnoteReferenceRun(doc, ctx.footnotes.allocate(inline))];
    }
    default:
      throw new GenerationInternalError(
        `Inline kind '${(inline as { kind: string }).kind}' reached the run emitter without a shipped emitter`,
      );
  }
}
