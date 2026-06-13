/**
 * word/fontTable.xml emitter.
 *
 * Emitted on every package. Word-authored documents declare a font table; we
 * enumerate the fonts the spec actually references (the Calibri default plus any
 * font named on a style, run, or numbering level) rather than a fixed stub, so the
 * metadata is faithful — a run set in Georgia produces a Georgia entry. panose1 is
 * omitted because we cannot derive it for an arbitrary font name, and Word tolerates
 * its absence. The walk is pure over the spec, so output stays deterministic.
 *
 * The root is the WordprocessingML `w:fonts` font-table element.
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { BlockSpec, DocumentSpec, RunProps } from '../types.js';

const FONT_TABLE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml';
const FONT_TABLE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';

/** The docDefaults run font (see styles-part.ts DEFAULT_FONT); always declared. */
const DEFAULT_FONT = 'Calibri';

export function emitFontTablePart(spec: DocumentSpec, ctx: CompileContext): void {
  ctx.registerPart('word/fontTable.xml', FONT_TABLE_CONTENT_TYPE, FONT_TABLE_REL_TYPE);

  const doc = parseXml(`<w:fonts xmlns:w="${OOXML.W_NS}"/>`);
  const root = doc.documentElement!;
  for (const name of collectFonts(spec)) {
    const font = createWmlElement(doc, W.font, { 'w:name': name });
    font.appendChild(createWmlElement(doc, W.charset, { 'w:val': '00' }));
    font.appendChild(createWmlElement(doc, W.family, { 'w:val': 'auto' }));
    font.appendChild(createWmlElement(doc, W.pitch, { 'w:val': 'variable' }));
    root.appendChild(font);
  }
  ctx.setFileContent('word/fontTable.xml', XML_DECL + serializeXml(doc));
}

/** Distinct fonts the spec references, sorted for determinism, default first. */
function collectFonts(spec: DocumentSpec): string[] {
  const names = new Set<string>();
  const add = (props?: Pick<RunProps, 'font'>) => {
    if (props?.font) names.add(props.font);
  };

  for (const style of spec.styles ?? []) add(style.run);
  for (const def of spec.numbering ?? []) {
    for (const level of def.levels) add(level.runProps);
  }
  for (const section of spec.sections) {
    for (const set of [section.headers, section.footers]) {
      for (const hf of [set?.default, set?.first, set?.even]) {
        if (hf) walkBlocks(hf.blocks, add);
      }
    }
    walkBlocks(section.blocks, add);
  }

  names.delete(DEFAULT_FONT);
  return [DEFAULT_FONT, ...Array.from(names).sort()];
}

function walkBlocks(blocks: BlockSpec[], add: (props?: Pick<RunProps, 'font'>) => void): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      for (const run of block.runs) {
        if (run.kind === 'text' || run.kind === 'field') add(run);
      }
    } else {
      for (const row of block.rows) {
        for (const cell of row.cells) walkBlocks(cell.blocks, add);
      }
    }
  }
}
