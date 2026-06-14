/**
 * Pre-compile validation of a DocumentSpec.
 *
 * Two jobs:
 *  1. Shape/referential checks for the spec subset whose emitters have shipped.
 *  2. Loud rejection of declared-but-not-yet-implemented spec features. The
 *     type surface covers the full add-docx-generation change; emitters land
 *     in phases, and a spec feature without an emitter must fail compilation
 *     with a typed error naming the feature and its path — never be silently
 *     dropped (scenario SDX-GEN-003).
 *
 * Shipped so far: formatted text/tab/break runs, five-part PAGE/NUMPAGES
 * fields, paragraph formatting, named styles + styles.xml, multi-section
 * documents with per-section page setup, page numbering, break types,
 * default/first/even headers and footers, tables (grid, spans, vertical
 * merges, cell decoration, nesting), multi-level numbering with w:numPr
 * list references, and drafting notes compiled to anchored comments (body
 * story only — header/footer paragraphs cannot carry notes).
 *
 * Every declared feature now has an emitter; the loud-rejection contract
 * (SDX-GEN-003) lives on as runtime guards against unrecognized block and
 * inline kinds, which protect callers handing in JSON that the TypeScript
 * surface never saw.
 */

import { GenerationSpecError } from './errors.js';
import type {
  BlockSpec,
  BorderSpec,
  DocumentSpec,
  InlineSpec,
  NumberingSpec,
  ParagraphSpec,
  RunProps,
  SectionSpec,
  StyleSpec,
  TableBorders,
  TableSpec,
} from './types.js';
import { HIGHLIGHT_COLORS } from './types.js';

const COLOR_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const HIGHLIGHT_COLOR_SET: ReadonlySet<string> = new Set(HIGHLIGHT_COLORS);

function unsupported(path: string, feature: string): never {
  throw new GenerationSpecError(
    'unsupported_feature',
    path,
    `Spec feature '${feature}' is declared in the DocumentSpec type surface but its emitter has not shipped yet; ` +
      'it is rejected rather than silently ignored',
  );
}

export function validateSpec(spec: DocumentSpec): void {
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
    throw new GenerationSpecError('empty_sections', '/sections', 'DocumentSpec.sections must contain at least one section');
  }

  const declaredStyleIds = validateStyles(spec.styles ?? []);
  const numbering = validateNumbering(spec.numbering ?? []);

  spec.sections.forEach((section, sectionIndex) => {
    validateSection(section, `/sections/${sectionIndex}`, declaredStyleIds, numbering);
  });
}

/** Returns numId handle → set of declared levels, for list-reference checks. */
function validateNumbering(definitions: NumberingSpec[]): Map<string, Set<number>> {
  const declared = new Map<string, Set<number>>();
  definitions.forEach((definition, index) => {
    const path = `/numbering/${index}`;
    if (!definition.numId) {
      throw new GenerationSpecError('invalid_value', `${path}/numId`, 'NumberingSpec requires a numId handle');
    }
    if (declared.has(definition.numId)) {
      throw new GenerationSpecError('invalid_value', `${path}/numId`, `Duplicate numbering handle '${definition.numId}'`);
    }
    if (!Array.isArray(definition.levels) || definition.levels.length === 0) {
      throw new GenerationSpecError('invalid_value', `${path}/levels`, 'Numbering definitions require at least one level');
    }
    const levels = new Set<number>();
    definition.levels.forEach((level, levelIndex) => {
      const levelPath = `${path}/levels/${levelIndex}`;
      if (!Number.isInteger(level.ilvl) || level.ilvl < 0 || level.ilvl > 8) {
        throw new GenerationSpecError('invalid_value', `${levelPath}/ilvl`, 'ilvl must be an integer between 0 and 8');
      }
      if (levels.has(level.ilvl)) {
        throw new GenerationSpecError('invalid_value', `${levelPath}/ilvl`, `Duplicate ilvl ${level.ilvl} in numbering '${definition.numId}'`);
      }
      levels.add(level.ilvl);
      if (typeof level.lvlText !== 'string' || level.lvlText.length === 0) {
        throw new GenerationSpecError('invalid_value', `${levelPath}/lvlText`, 'Numbering levels require a lvlText pattern');
      }
      if (level.start !== undefined && (!Number.isInteger(level.start) || level.start < 0)) {
        throw new GenerationSpecError('invalid_value', `${levelPath}/start`, 'Level start must be a non-negative integer');
      }
      if (level.runProps) validateRunProps(level.runProps, `${levelPath}/runProps`);
    });
    declared.set(definition.numId, levels);
  });
  return declared;
}

/** Returns the set of resolvable style ids (declared styles + implicit Normal). */
function validateStyles(styles: StyleSpec[]): Set<string> {
  const ids = new Set<string>(['Normal']);
  styles.forEach((style, index) => {
    const path = `/styles/${index}`;
    if (!style.styleId || !style.name) {
      throw new GenerationSpecError('invalid_value', path, 'StyleSpec requires styleId and name');
    }
    if (ids.has(style.styleId)) {
      throw new GenerationSpecError('invalid_value', `${path}/styleId`, `Duplicate styleId '${style.styleId}'`);
    }
    ids.add(style.styleId);
    if (style.run) validateRunProps(style.run, `${path}/run`);
  });
  // basedOn / next must resolve against the full declared set (forward refs allowed).
  styles.forEach((style, index) => {
    const path = `/styles/${index}`;
    for (const key of ['basedOn', 'next'] as const) {
      const ref = style[key];
      if (ref !== undefined && !ids.has(ref)) {
        throw new GenerationSpecError(
          'dangling_style_reference',
          `${path}/${key}`,
          `Style '${style.styleId}' references undeclared style '${ref}' via ${key}`,
        );
      }
    }
  });
  return ids;
}

function validateSection(section: SectionSpec, path: string, styleIds: Set<string>, numbering: Map<string, Set<number>>): void {
  if (section.pageNumbering?.start !== undefined) {
    const start = section.pageNumbering.start;
    if (!Number.isInteger(start) || start < 1) {
      throw new GenerationSpecError('invalid_value', `${path}/pageNumbering/start`, 'Page numbering start must be a positive integer');
    }
  }
  for (const [kind, set] of [['headers', section.headers], ['footers', section.footers]] as const) {
    if (!set) continue;
    for (const slot of ['default', 'first', 'even'] as const) {
      const content = set[slot];
      if (!content) continue;
      const slotPath = `${path}/${kind}/${slot}`;
      if (!Array.isArray(content.blocks) || content.blocks.length === 0) {
        throw new GenerationSpecError('invalid_value', `${slotPath}/blocks`, 'Header/footer blocks must be a non-empty array');
      }
      content.blocks.forEach((block, blockIndex) => {
        validateBlock(block, `${slotPath}/blocks/${blockIndex}`, styleIds, numbering, 'headerFooter');
      });
    }
  }

  const size = section.page?.sizeTwips;
  if (size && (!(size.w > 0) || !(size.h > 0))) {
    throw new GenerationSpecError('invalid_value', `${path}/page/sizeTwips`, 'Page size dimensions must be positive twips');
  }
  const margins = section.page?.marginsTwips;
  if (margins) {
    for (const [key, value] of Object.entries(margins)) {
      if (value !== undefined && (typeof value !== 'number' || value < 0 || !Number.isFinite(value))) {
        throw new GenerationSpecError('invalid_value', `${path}/page/marginsTwips/${key}`, 'Margins must be non-negative finite twips');
      }
    }
  }

  if (!Array.isArray(section.blocks)) {
    throw new GenerationSpecError('invalid_value', `${path}/blocks`, 'Section blocks must be an array');
  }
  section.blocks.forEach((block, blockIndex) => {
    validateBlock(block, `${path}/blocks/${blockIndex}`, styleIds, numbering, 'body');
  });
}

/** Story kind: drafting notes may only anchor in the body story. */
type StoryContext = 'body' | 'headerFooter';

function validateBlock(
  block: BlockSpec,
  path: string,
  styleIds: Set<string>,
  numbering: Map<string, Set<number>>,
  story: StoryContext,
): void {
  if (block.kind === 'table') validateTable(block, path, styleIds, numbering, story);
  else if (block.kind === 'paragraph') validateParagraph(block, path, styleIds, numbering, story);
  else unsupported(path, `block kind '${(block as { kind: string }).kind}'`);
}

/**
 * Table shape and grid arithmetic. Every row's effective column count
 * (the sum of its cells' gridSpans) must equal the declared grid, and a
 * vertical-merge continuation must sit at exactly the grid position and
 * span of a merge cell in the previous row — otherwise readers either show
 * a recovery dialog or silently reflow the table.
 */
function validateTable(table: TableSpec, path: string, styleIds: Set<string>, numbering: Map<string, Set<number>>, story: StoryContext): void {
  if (!Array.isArray(table.columnWidthsTwips) || table.columnWidthsTwips.length === 0) {
    throw new GenerationSpecError('invalid_value', `${path}/columnWidthsTwips`, 'Tables require at least one column width');
  }
  table.columnWidthsTwips.forEach((width, i) => {
    if (!(width > 0) || !Number.isFinite(width)) {
      throw new GenerationSpecError('invalid_value', `${path}/columnWidthsTwips/${i}`, 'Column widths must be positive finite twips');
    }
  });
  if (table.borders) validateBorders(table.borders, `${path}/borders`);
  if (!Array.isArray(table.rows) || table.rows.length === 0) {
    throw new GenerationSpecError('invalid_value', `${path}/rows`, 'Tables require at least one row');
  }

  const columnCount = table.columnWidthsTwips.length;
  // Grid start → span of every merge-participating cell in the previous row.
  let previousMerges = new Map<number, number>();
  table.rows.forEach((row, rowIndex) => {
    const rowPath = `${path}/rows/${rowIndex}`;
    if (!Array.isArray(row.cells) || row.cells.length === 0) {
      throw new GenerationSpecError('invalid_value', `${rowPath}/cells`, 'Rows require at least one cell');
    }
    if (row.heightTwips !== undefined && (!(row.heightTwips > 0) || !Number.isFinite(row.heightTwips))) {
      throw new GenerationSpecError('invalid_value', `${rowPath}/heightTwips`, 'Row height must be positive finite twips');
    }

    const currentMerges = new Map<number, number>();
    let gridOffset = 0;
    row.cells.forEach((cell, cellIndex) => {
      const cellPath = `${rowPath}/cells/${cellIndex}`;
      if (cell.gridSpan !== undefined && (!Number.isInteger(cell.gridSpan) || cell.gridSpan < 1)) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/gridSpan`, 'gridSpan must be a positive integer');
      }
      const span = cell.gridSpan ?? 1;
      if (cell.vMerge === 'continue') {
        if (rowIndex === 0) {
          throw new GenerationSpecError('grid_mismatch', `${cellPath}/vMerge`, 'A vertical merge cannot continue in the first row');
        }
        if (previousMerges.get(gridOffset) !== span) {
          throw new GenerationSpecError(
            'grid_mismatch',
            `${cellPath}/vMerge`,
            `vMerge continuation at grid column ${gridOffset} (span ${span}) has no matching merge cell in the previous row`,
          );
        }
      }
      if (cell.vMerge !== undefined) currentMerges.set(gridOffset, span);
      if (cell.widthTwips !== undefined && (!(cell.widthTwips > 0) || !Number.isFinite(cell.widthTwips))) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/widthTwips`, 'Cell width must be positive finite twips');
      }
      if (cell.borders) validateBorders(cell.borders, `${cellPath}/borders`);
      if (cell.shadingHex !== undefined && !COLOR_HEX_RE.test(cell.shadingHex)) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/shadingHex`, `shadingHex must be six hex digits without '#', got '${cell.shadingHex}'`);
      }
      if (cell.marginsTwips) {
        for (const [key, value] of Object.entries(cell.marginsTwips)) {
          if (value !== undefined && (typeof value !== 'number' || value < 0 || !Number.isFinite(value))) {
            throw new GenerationSpecError('invalid_value', `${cellPath}/marginsTwips/${key}`, 'Cell margins must be non-negative finite twips');
          }
        }
      }
      if (!Array.isArray(cell.blocks)) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/blocks`, 'Cell blocks must be an array (empty allowed; an empty cell compiles to an empty paragraph)');
      }
      cell.blocks.forEach((block, blockIndex) => {
        validateBlock(block, `${cellPath}/blocks/${blockIndex}`, styleIds, numbering, story);
      });
      gridOffset += span;
    });

    if (gridOffset !== columnCount) {
      throw new GenerationSpecError(
        'grid_mismatch',
        rowPath,
        `Row spans ${gridOffset} grid column(s) but the table declares ${columnCount}`,
      );
    }
    previousMerges = currentMerges;
  });
}

function validateBorders(borders: TableBorders, path: string): void {
  for (const [edge, spec] of Object.entries(borders) as Array<[string, BorderSpec | undefined]>) {
    if (!spec) continue;
    if (spec.colorHex !== undefined && !COLOR_HEX_RE.test(spec.colorHex)) {
      throw new GenerationSpecError('invalid_value', `${path}/${edge}/colorHex`, `colorHex must be six hex digits without '#', got '${spec.colorHex}'`);
    }
    if (spec.sizeEighthPt !== undefined && (!(spec.sizeEighthPt > 0) || !Number.isFinite(spec.sizeEighthPt))) {
      throw new GenerationSpecError('invalid_value', `${path}/${edge}/sizeEighthPt`, 'Border size must be positive finite eighth-points');
    }
  }
}

function validateParagraph(
  paragraph: ParagraphSpec,
  path: string,
  styleIds: Set<string>,
  numbering: Map<string, Set<number>>,
  story: StoryContext,
): void {
  if (paragraph.note !== undefined) {
    if (story === 'headerFooter') {
      throw new GenerationSpecError(
        'invalid_value',
        `${path}/note`,
        'Drafting notes anchor as document-story comments and cannot live in headers or footers',
      );
    }
    if (typeof paragraph.note.text !== 'string' || paragraph.note.text.length === 0) {
      throw new GenerationSpecError('invalid_value', `${path}/note/text`, 'Drafting notes require non-empty text');
    }
  }

  if (paragraph.list !== undefined) {
    const levels = numbering.get(paragraph.list.numId);
    if (!levels) {
      throw new GenerationSpecError(
        'dangling_numbering_reference',
        `${path}/list/numId`,
        `Paragraph references undeclared numbering '${paragraph.list.numId}'`,
      );
    }
    if (!levels.has(paragraph.list.ilvl)) {
      throw new GenerationSpecError(
        'dangling_numbering_reference',
        `${path}/list/ilvl`,
        `Numbering '${paragraph.list.numId}' declares no level ${paragraph.list.ilvl}`,
      );
    }
  }

  if (paragraph.styleId !== undefined && !styleIds.has(paragraph.styleId)) {
    throw new GenerationSpecError(
      'dangling_style_reference',
      `${path}/styleId`,
      `Paragraph references undeclared style '${paragraph.styleId}'`,
    );
  }
  if (paragraph.tabs) {
    paragraph.tabs.forEach((stop, i) => {
      if (!(stop.posTwips >= 0) || !Number.isFinite(stop.posTwips)) {
        throw new GenerationSpecError('invalid_value', `${path}/tabs/${i}/posTwips`, 'Tab stop position must be a non-negative finite twips value');
      }
    });
  }

  if (!Array.isArray(paragraph.runs)) {
    throw new GenerationSpecError('invalid_value', `${path}/runs`, 'Paragraph runs must be an array');
  }
  paragraph.runs.forEach((run, runIndex) => {
    validateInline(run, `${path}/runs/${runIndex}`);
  });
}

function validateInline(run: InlineSpec, path: string): void {
  if (run.kind !== 'tab' && run.kind !== 'break' && run.kind !== 'field' && run.kind !== 'text') {
    unsupported(path, `inline kind '${(run as { kind: string }).kind}'`);
  }
  if (run.kind === 'tab' || run.kind === 'break') return;
  if (run.kind === 'field') {
    if (typeof run.cachedResult !== 'string' || run.cachedResult.length === 0) {
      throw new GenerationSpecError(
        'invalid_value',
        `${path}/cachedResult`,
        'Fields require a non-empty cachedResult — the no-recovery-dialog guarantee is unrepresentable-by-omission',
      );
    }
    validateRunProps(run, path);
    return;
  }

  if (typeof run.text !== 'string') {
    throw new GenerationSpecError('invalid_value', `${path}/text`, 'Text runs must carry a string');
  }
  validateRunProps(run, path);
}

function validateRunProps(props: RunProps, path: string): void {
  if (props.colorHex !== undefined && !COLOR_HEX_RE.test(props.colorHex)) {
    throw new GenerationSpecError('invalid_value', `${path}/colorHex`, `colorHex must be six hex digits without '#', got '${props.colorHex}'`);
  }
  if (props.sizePt !== undefined && (!(props.sizePt > 0) || !Number.isFinite(props.sizePt))) {
    throw new GenerationSpecError('invalid_value', `${path}/sizePt`, 'sizePt must be a positive finite number');
  }
  if (props.highlight !== undefined && !HIGHLIGHT_COLOR_SET.has(props.highlight)) {
    throw new GenerationSpecError(
      'invalid_value',
      `${path}/highlight`,
      `highlight must be one of the fixed CT_HighlightColor values, got '${props.highlight}'`,
    );
  }
}
