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
import { WML_SCHEMA_ENUM_SETS, type WmlSchemaEnumType } from './schema-enum-domains.js';
import type {
  BlockSpec,
  BorderSpec,
  DocumentSpec,
  InlineSpec,
  NumberingSpec,
  ParagraphSpec,
  ParagraphBorders,
  RunProps,
  SectionSpec,
  StyleSpec,
  TableBorders,
  TableSpec,
} from './types.js';
import { HIGHLIGHT_COLORS, NUMBERING_LEVEL_JUSTIFICATIONS, THEME_COLOR_SLOTS } from './types.js';

const COLOR_HEX_RE = /^[0-9A-Fa-f]{6}$/;
const TWO_HEX_RE = /^[0-9A-Fa-f]{2}$/;
const HIGHLIGHT_COLOR_SET: ReadonlySet<string> = new Set(HIGHLIGHT_COLORS);
const LVL_JC_SET: ReadonlySet<string> = new Set(NUMBERING_LEVEL_JUSTIFICATIONS);
const THEME_COLOR_SLOT_SET: ReadonlySet<string> = new Set(THEME_COLOR_SLOTS);
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const UNDERLINES = new Set(['single', 'double', 'none']);
const TAB_ALIGNMENTS = new Set(['left', 'center', 'right']);
const TAB_LEADERS = new Set(['none', 'dot', 'underscore']);
const LINE_RULES = new Set(['auto', 'exact', 'atLeast']);
const TABLE_LAYOUTS = new Set(['fixed', 'autofit']);
const BORDER_STYLES = new Set(['single', 'double', 'none']);
const ROW_HEIGHT_RULES = new Set(['atLeast', 'exact']);
const CELL_VERTICAL_ALIGNMENTS = new Set(['top', 'center', 'bottom']);
const VERTICAL_MERGES = new Set(['restart', 'continue']);
const STYLE_TYPES = new Set(['paragraph', 'character']);
const NUMBER_FORMATS = new Set(['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman', 'bullet', 'none']);
const NUMBER_SUFFIXES = new Set(['tab', 'space', 'nothing']);

function requireInteger(value: unknown, path: string, description: string, minimum?: number, maximum?: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new GenerationSpecError('invalid_value', path, description);
  }
}

function unsupported(path: string, feature: string): never {
  throw new GenerationSpecError(
    'unsupported_feature',
    path,
    `Spec feature '${feature}' is declared in the DocumentSpec type surface but its emitter has not shipped yet; ` +
      'it is rejected rather than silently ignored',
  );
}

function unsupportedApiValue(path: string, value: unknown, schemaType: string): never {
  throw new GenerationSpecError(
    'unsupported_feature',
    path,
    `Value '${String(value)}' is valid in ${schemaType} but is outside the DocumentSpec API-supported subset`,
  );
}

function requireSupportedSchemaEnum(
  value: unknown,
  path: string,
  schemaType: WmlSchemaEnumType,
  supportedValues: ReadonlySet<string>,
): void {
  if (typeof value === 'string' && supportedValues.has(value)) return;
  if (typeof value === 'string' && WML_SCHEMA_ENUM_SETS[schemaType].has(value)) {
    unsupportedApiValue(path, value, schemaType);
  }
  throw new GenerationSpecError(
    'invalid_value',
    path,
    `Value '${String(value)}' is outside the ${schemaType} schema domain`,
  );
}

function requireSupportedHexColor(value: unknown, path: string): void {
  if (typeof value === 'string' && COLOR_HEX_RE.test(value)) return;
  if (value === 'auto') unsupportedApiValue(path, value, 'ST_HexColor');
  throw new GenerationSpecError(
    'invalid_value',
    path,
    `Value '${String(value)}' is outside the ST_HexColor schema domain`,
  );
}

export function validateSpec(spec: DocumentSpec): void {
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
    throw new GenerationSpecError('empty_sections', '/sections', 'DocumentSpec.sections must contain at least one section');
  }

  validateTheme(spec);
  const declaredStyleIds = validateStyles(spec.styles ?? []);
  const numbering = validateNumbering(spec.numbering ?? []);

  spec.sections.forEach((section, sectionIndex) => {
    validateSection(section, `/sections/${sectionIndex}`, declaredStyleIds, numbering);
  });
}

function validateTheme(spec: DocumentSpec): void {
  if (!spec.theme?.colors) return;
  for (const [slot, hex] of Object.entries(spec.theme.colors)) {
    if (!THEME_COLOR_SLOT_SET.has(slot)) {
      throw new GenerationSpecError('invalid_value', `/theme/colors/${slot}`, `theme color slot must be one of the supported theme slots, got '${slot}'`);
    }
    if (typeof hex !== 'string' || !COLOR_HEX_RE.test(hex)) {
      throw new GenerationSpecError('invalid_value', `/theme/colors/${slot}`, `theme color value must be six hex digits without '#', got '${hex}'`);
    }
  }
}

/**
 * Returns numId handle -> set of declared levels, for list-reference checks.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.28
 */
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
      requireSupportedSchemaEnum(level.numFmt, `${levelPath}/numFmt`, 'ST_NumberFormat', NUMBER_FORMATS);
      if (level.suff !== undefined) {
        requireSupportedSchemaEnum(level.suff, `${levelPath}/suff`, 'ST_LevelSuffix', NUMBER_SUFFIXES);
      }
      if (level.start !== undefined) {
        requireInteger(
          level.start,
          `${levelPath}/start`,
          'Level start must be a signed safe integer in the API-representable subset of ST_DecimalNumber',
        );
      }
      if (level.lvlJc !== undefined) {
        requireSupportedSchemaEnum(level.lvlJc, `${levelPath}/lvlJc`, 'ST_Jc', LVL_JC_SET);
      }
      if (level.runProps) validateRunProps(level.runProps, `${levelPath}/runProps`);
      if (level.indentTwips) {
        if (level.indentTwips.left !== undefined) {
          requireInteger(
            level.indentTwips.left,
            `${levelPath}/indentTwips/left`,
            'Numbering left indentation must be a signed safe integer in the API-representable subset of ST_SignedTwipsMeasure',
          );
        }
        if (level.indentTwips.hanging !== undefined) {
          requireInteger(
            level.indentTwips.hanging,
            `${levelPath}/indentTwips/hanging`,
            'Numbering hanging indentation must be a non-negative safe integer in the API-representable subset of ST_TwipsMeasure',
            0,
          );
        }
      }
    });
    declared.set(definition.numId, levels);
  });
  return declared;
}

/**
 * Returns the set of resolvable style ids (declared styles + implicit Normal).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 */
function validateStyles(styles: StyleSpec[]): Set<string> {
  const ids = new Set<string>(['Normal']);
  styles.forEach((style, index) => {
    const path = `/styles/${index}`;
    if (!style.styleId || !style.name) {
      throw new GenerationSpecError('invalid_value', path, 'StyleSpec requires styleId and name');
    }
    requireSupportedSchemaEnum(style.type, `${path}/type`, 'ST_StyleType', STYLE_TYPES);
    if (ids.has(style.styleId)) {
      throw new GenerationSpecError('invalid_value', `${path}/styleId`, `Duplicate styleId '${style.styleId}'`);
    }
    ids.add(style.styleId);
    if (style.paragraph) validateParagraphProps(style.paragraph, `${path}/paragraph`);
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
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.37
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.48
 */
function validateTable(table: TableSpec, path: string, styleIds: Set<string>, numbering: Map<string, Set<number>>, story: StoryContext): void {
  if (table.layout !== undefined) {
    requireSupportedSchemaEnum(table.layout, `${path}/layout`, 'ST_TblLayoutType', TABLE_LAYOUTS);
  }
  if (!Array.isArray(table.columnWidthsTwips) || table.columnWidthsTwips.length === 0) {
    throw new GenerationSpecError('invalid_value', `${path}/columnWidthsTwips`, 'Tables require at least one column width');
  }
  table.columnWidthsTwips.forEach((width, i) => {
    requireInteger(
      width,
      `${path}/columnWidthsTwips/${i}`,
      'Column widths must be non-negative safe integers in the API-representable integer branch of ST_TwipsMeasure',
      0,
    );
  });
  const totalWidth = table.columnWidthsTwips.reduce((sum, width) => sum + width, 0);
  if (!Number.isSafeInteger(totalWidth)) {
    throw new GenerationSpecError(
      'invalid_value',
      `${path}/columnWidthsTwips`,
      'The table width sum must remain a safe integer so w:tblW serializes exactly',
    );
  }
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
    if (row.heightTwips !== undefined) {
      requireInteger(
        row.heightTwips,
        `${rowPath}/heightTwips`,
        'Row height must be a non-negative safe integer in the ST_TwipsMeasure domain',
        0,
      );
    }
    if (row.heightRule !== undefined) {
      requireSupportedSchemaEnum(row.heightRule, `${rowPath}/heightRule`, 'ST_HeightRule', ROW_HEIGHT_RULES);
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
      if (cell.vMerge !== undefined) {
        requireSupportedSchemaEnum(cell.vMerge, `${cellPath}/vMerge`, 'ST_Merge', VERTICAL_MERGES);
      }
      if (cell.vMerge !== undefined) currentMerges.set(gridOffset, span);
      if (cell.widthTwips !== undefined) {
        requireInteger(
          cell.widthTwips,
          `${cellPath}/widthTwips`,
          'Cell width must be a signed safe integer in the API-representable integer branch of ST_MeasurementOrPercent',
        );
      }
      if (cell.borders) validateBorders(cell.borders, `${cellPath}/borders`);
      if (cell.vAlign !== undefined) {
        requireSupportedSchemaEnum(cell.vAlign, `${cellPath}/vAlign`, 'ST_VerticalJc', CELL_VERTICAL_ALIGNMENTS);
      }
      if (cell.shadingHex !== undefined) requireSupportedHexColor(cell.shadingHex, `${cellPath}/shadingHex`);
      if (cell.themeFill !== undefined) {
        validateThemeColorSlot(cell.themeFill, `${cellPath}/themeFill`, 'themeFill');
      }
      if (cell.shadingHex !== undefined && cell.themeFill !== undefined) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/themeFill`, 'themeFill cannot be set when shadingHex is also set');
      }
      validateOptionalTwoHex(cell.themeFillTint, `${cellPath}/themeFillTint`, 'themeFillTint');
      validateOptionalTwoHex(cell.themeFillShade, `${cellPath}/themeFillShade`, 'themeFillShade');
      if ((cell.themeFillTint !== undefined || cell.themeFillShade !== undefined) && cell.themeFill === undefined) {
        throw new GenerationSpecError('invalid_value', `${cellPath}/themeFill`, 'themeFill is required when themeFillTint or themeFillShade is set');
      }
      if (cell.marginsTwips) {
        for (const [key, value] of Object.entries(cell.marginsTwips)) {
          if (value !== undefined) {
            requireInteger(
              value,
              `${cellPath}/marginsTwips/${key}`,
              'Cell margins must be signed safe integers in the API-representable integer branch of ST_MeasurementOrPercent',
            );
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

function validateBorders(borders: TableBorders | ParagraphBorders, path: string): void {
  for (const [edge, spec] of Object.entries(borders) as Array<[string, BorderSpec | undefined]>) {
    if (!spec) continue;
    requireSupportedSchemaEnum(spec.style, `${path}/${edge}/style`, 'ST_Border', BORDER_STYLES);
    if (spec.colorHex !== undefined) requireSupportedHexColor(spec.colorHex, `${path}/${edge}/colorHex`);
    if (spec.sizeEighthPt !== undefined) {
      requireInteger(
        spec.sizeEighthPt,
        `${path}/${edge}/sizeEighthPt`,
        'Border size must be a non-negative safe integer in the ST_EighthPointMeasure domain',
        0,
      );
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
  validateParagraphProps(paragraph, path);

  if (!Array.isArray(paragraph.runs)) {
    throw new GenerationSpecError('invalid_value', `${path}/runs`, 'Paragraph runs must be an array');
  }
  paragraph.runs.forEach((run, runIndex) => {
    validateInline(run, `${path}/runs/${runIndex}`);
  });
}

type ParagraphProperties = NonNullable<StyleSpec['paragraph']>;

/** Validate the paragraph-property subset shared by body paragraphs and styles. */
function validateParagraphProps(props: ParagraphProperties, path: string): void {
  if (props.borders) validateBorders(props.borders, `${path}/borders`);
  if (props.tabs) {
    props.tabs.forEach((stop, i) => {
      requireInteger(stop.posTwips, `${path}/tabs/${i}/posTwips`, 'Tab stop position must be a non-negative safe integer in twips', 0);
      if (!TAB_ALIGNMENTS.has(stop.align)) throw new GenerationSpecError('invalid_value', `${path}/tabs/${i}/align`, `Unsupported tab alignment '${stop.align}'`);
      if (stop.leader !== undefined && !TAB_LEADERS.has(stop.leader)) throw new GenerationSpecError('invalid_value', `${path}/tabs/${i}/leader`, `Unsupported tab leader '${stop.leader}'`);
    });
  }
  if (props.alignment !== undefined && !ALIGNMENTS.has(props.alignment)) {
    throw new GenerationSpecError('invalid_value', `${path}/alignment`, `Unsupported paragraph alignment '${props.alignment}'`);
  }
  if (props.spacing) {
    for (const key of ['beforeTwips', 'afterTwips'] as const) {
      const value = props.spacing[key];
      if (value !== undefined) requireInteger(value, `${path}/spacing/${key}`, `${key} must be a non-negative safe integer`, 0);
    }
    if (props.spacing.lineTwips !== undefined) requireInteger(props.spacing.lineTwips, `${path}/spacing/lineTwips`, 'lineTwips must be a safe integer');
    if (props.spacing.lineRule !== undefined && !LINE_RULES.has(props.spacing.lineRule)) {
      throw new GenerationSpecError('invalid_value', `${path}/spacing/lineRule`, `Unsupported line rule '${props.spacing.lineRule}'`);
    }
  }
  if (props.indent) {
    for (const key of ['leftTwips', 'rightTwips'] as const) {
      const value = props.indent[key];
      if (value !== undefined) requireInteger(value, `${path}/indent/${key}`, `${key} must be a safe integer`);
    }
    for (const key of ['firstLineTwips', 'hangingTwips'] as const) {
      const value = props.indent[key];
      if (value !== undefined) requireInteger(value, `${path}/indent/${key}`, `${key} must be a non-negative safe integer`, 0);
    }
    if (props.indent.firstLineTwips !== undefined && props.indent.hangingTwips !== undefined) {
      throw new GenerationSpecError('invalid_value', `${path}/indent`, 'firstLineTwips and hangingTwips are mutually exclusive');
    }
  }
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
  if (props.underline !== undefined) {
    requireSupportedSchemaEnum(props.underline, `${path}/underline`, 'ST_Underline', UNDERLINES);
  }
  if (props.colorHex !== undefined) requireSupportedHexColor(props.colorHex, `${path}/colorHex`);
  if (props.themeColor !== undefined) {
    validateThemeColorSlot(props.themeColor, `${path}/themeColor`, 'themeColor');
  }
  if (props.colorHex !== undefined && props.themeColor !== undefined) {
    throw new GenerationSpecError('invalid_value', `${path}/themeColor`, 'themeColor cannot be set when colorHex is also set');
  }
  validateOptionalTwoHex(props.themeTint, `${path}/themeTint`, 'themeTint');
  validateOptionalTwoHex(props.themeShade, `${path}/themeShade`, 'themeShade');
  if ((props.themeTint !== undefined || props.themeShade !== undefined) && props.themeColor === undefined) {
    throw new GenerationSpecError('invalid_value', `${path}/themeColor`, 'themeColor is required when themeTint or themeShade is set');
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

function validateThemeColorSlot(value: string, path: string, fieldName: string): void {
  if (!THEME_COLOR_SLOT_SET.has(value)) {
    throw new GenerationSpecError('invalid_value', path, `${fieldName} must be one of the supported theme slots, got '${value}'`);
  }
}

function validateOptionalTwoHex(value: string | undefined, path: string, fieldName: string): void {
  if (value !== undefined && !TWO_HEX_RE.test(value)) {
    throw new GenerationSpecError('invalid_value', path, `${fieldName} must be two hex digits without '#', got '${value}'`);
  }
}
