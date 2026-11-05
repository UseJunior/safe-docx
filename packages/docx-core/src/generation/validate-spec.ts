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
 * list references, drafting notes compiled to anchored comments (body
 * story only — header/footer paragraphs cannot carry notes), and footnotes
 * (body story only, table cells included; paragraphs only, never nested).
 *
 * Every declared feature now has an emitter; the loud-rejection contract
 * (SDX-GEN-003) lives on as runtime guards against unrecognized block and
 * inline kinds, which protect callers handing in JSON that the TypeScript
 * surface never saw.
 */

import { isWordBookmarkName } from './bookmark-names.js';
import { GenerationSpecError } from './errors.js';
import { WML_SCHEMA_ENUM_SETS, type WmlSchemaEnumType } from './schema-enum-domains.js';
import { FOOTNOTE_REFERENCE_STYLE_ID, FOOTNOTE_TEXT_STYLE_ID } from '../primitives/footnote-shapes.js';
import type {
  BlockSpec,
  BorderSpec,
  DocumentSpec,
  FootnoteSpec,
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
import {
  CROSS_REFERENCE_NUMBERS,
  CROSS_REFERENCE_SHOWS,
  HIGHLIGHT_COLORS,
  NUMBERING_LEVEL_FORMATS,
  NUMBERING_LEVEL_JUSTIFICATIONS,
  THEME_COLOR_SLOTS,
  type TabStopSpec,
} from './types.js';

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
const NUMBER_FORMATS: ReadonlySet<string> = new Set(NUMBERING_LEVEL_FORMATS);
const NUMBER_SUFFIXES = new Set(['tab', 'space', 'nothing']);
const CROSS_REFERENCE_NUMBER_SET: ReadonlySet<string> = new Set(CROSS_REFERENCE_NUMBERS);
const CROSS_REFERENCE_SHOW_SET: ReadonlySet<string> = new Set(CROSS_REFERENCE_SHOWS);

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
  if (spec.defaults?.run) validateRunProps(spec.defaults.run, '/defaults/run');
  if (spec.defaults?.paragraph) validateParagraphProps(spec.defaults.paragraph, '/defaults/paragraph');
  const declaredStyleIds = validateStyles(spec.styles ?? []);
  if (specHasFootnotes(spec)) {
    validateFootnoteStyles(spec.styles ?? []);
    declaredStyleIds.add(FOOTNOTE_TEXT_STYLE_ID);
    declaredStyleIds.add(FOOTNOTE_REFERENCE_STYLE_ID);
  }
  const numbering = validateNumbering(spec.numbering ?? [], spec.styles ?? []);

  spec.sections.forEach((section, sectionIndex) => {
    validateSection(section, `/sections/${sectionIndex}`, declaredStyleIds, numbering);
    validateBreakPlacement(section, `/sections/${sectionIndex}`, sectionIndex === spec.sections.length - 1);
  });
  validateCrossReferences(spec);
}

type ParagraphVisitor = (paragraph: ParagraphSpec, path: string, story: StoryContext) => void;

/** Every paragraph of `blocks`, table cells and footnote bodies included, with its path and story. */
function walkParagraphs(blocks: BlockSpec[], path: string, story: StoryContext, visit: ParagraphVisitor): void {
  blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}/${blockIndex}`;
    if (block.kind === 'table') {
      block.rows.forEach((row, rowIndex) => row.cells.forEach((cell, cellIndex) => {
        walkParagraphs(cell.blocks, `${blockPath}/rows/${rowIndex}/cells/${cellIndex}/blocks`, story, visit);
      }));
      return;
    }
    visit(block, blockPath, story);
    block.runs.forEach((run, runIndex) => {
      if (run.kind === 'footnote') walkParagraphs(run.blocks, `${blockPath}/runs/${runIndex}/blocks`, 'footnote', visit);
    });
  });
}

/** Every paragraph of the document: body (with footnotes), then headers and footers. */
function walkDocumentParagraphs(spec: DocumentSpec, visit: ParagraphVisitor): void {
  spec.sections.forEach((section, sectionIndex) => {
    const path = `/sections/${sectionIndex}`;
    walkParagraphs(section.blocks, `${path}/blocks`, 'body', visit);
    for (const [kind, set] of [['headers', section.headers], ['footers', section.footers]] as const) {
      for (const slot of ['default', 'first', 'even'] as const) {
        const content = set?.[slot];
        if (content) walkParagraphs(content.blocks, `${path}/${kind}/${slot}/blocks`, 'headerFooter', visit);
      }
    }
  });
}

/**
 * The spec path of each body paragraph's bookmark, keyed by name. Run after
 * {@link validateSpec}, which guarantees names are unique and body-only.
 */
export function collectBookmarkPaths(spec: DocumentSpec): Map<string, string> {
  const paths = new Map<string, string>();
  walkDocumentParagraphs(spec, (paragraph, path, story) => {
    if (story === 'body' && paragraph.bookmark !== undefined && !paths.has(paragraph.bookmark)) paths.set(paragraph.bookmark, path);
  });
  return paths;
}

/**
 * Bookmarks sit only on body paragraphs (table cells included) and follow
 * Word's Bookmark dialog rules: at most 40 characters, a letter first, then
 * letters, digits and underscores, so none is hidden. Names are unique
 * without regard to case. A cross-reference sits in the body or a footnote,
 * never a header or footer, and names a declared bookmark exactly.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 */
function validateCrossReferences(spec: DocumentSpec): void {
  const bookmarks = new Map<string, ParagraphSpec>();
  const folded = new Map<string, string>();
  walkDocumentParagraphs(spec, (paragraph, path, story) => {
    if (paragraph.bookmark === undefined) return;
    const bookmarkPath = `${path}/bookmark`;
    if (story !== 'body') {
      throw new GenerationSpecError(
        'invalid_value',
        bookmarkPath,
        story === 'footnote' ? 'Bookmarks may sit only on body paragraphs, not in footnotes' : 'Bookmarks may sit only on body paragraphs, not in headers or footers',
      );
    }
    if (typeof paragraph.bookmark !== 'string' || !isWordBookmarkName(paragraph.bookmark)) {
      throw new GenerationSpecError(
        'invalid_value',
        bookmarkPath,
        `Bookmark name '${String(paragraph.bookmark)}' must be at most 40 characters, start with a letter and hold only letters, digits and underscores`,
      );
    }
    const key = paragraph.bookmark.toLowerCase();
    const earlier = folded.get(key);
    if (earlier !== undefined) {
      throw new GenerationSpecError('invalid_value', bookmarkPath, `Bookmark name '${paragraph.bookmark}' repeats '${earlier}'; bookmark names are unique regardless of case`);
    }
    folded.set(key, paragraph.bookmark);
    bookmarks.set(paragraph.bookmark, paragraph);
  });
  walkDocumentParagraphs(spec, (paragraph, path, story) => {
    paragraph.runs.forEach((run, runIndex) => {
      if (run.kind !== 'crossReference') return;
      const runPath = `${path}/runs/${runIndex}`;
      if (story === 'headerFooter') {
        throw new GenerationSpecError('invalid_value', runPath, 'Cross-references may appear in the body and in footnotes, not in headers or footers');
      }
      const target = bookmarks.get(run.bookmark);
      if (!target) {
        throw new GenerationSpecError('dangling_bookmark_reference', `${runPath}/bookmark`, `Cross-reference names undeclared bookmark '${String(run.bookmark)}'`);
      }
      if (run.show === 'text') validateTextReferenceTarget(run.bookmark, target, `${runPath}/show`);
    });
  });
}

/**
 * A text cross-reference shows its target paragraph's text: REF "inserts the
 * text or graphics represented by the bookmark" (§ 17.16.5.51). The result
 * is the target's text runs; Word leaves a footnote reference mark out of it
 * (without the `\f` switch) and the list label is not bookmarked content
 * (#1259 Word evidence). A tab, break, field or nested cross-reference in the
 * target is refused: what Word shows for it in a REF result is not
 * measured. A blank target would show nothing.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 */
function validateTextReferenceTarget(bookmark: string, target: ParagraphSpec, path: string): void {
  const unsupportedRun = target.runs.find((inline) => inline.kind !== 'text' && inline.kind !== 'footnote');
  if (unsupportedRun) {
    throw new GenerationSpecError(
      'invalid_value',
      path,
      `A text cross-reference to bookmark '${bookmark}' needs a target holding only text and footnote references; its paragraph holds a ${unsupportedRun.kind}`,
    );
  }
  const shown = target.runs.map((inline) => (inline.kind === 'text' ? inline.text : '')).join('');
  if (shown.trim().length === 0) {
    throw new GenerationSpecError('invalid_value', path, `A text cross-reference to bookmark '${bookmark}' would show empty text`);
  }
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
 * Every instance handle (a definition's own and each additional instance's)
 * maps to its definition's level set.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.28
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.8
 */
function validateNumbering(definitions: NumberingSpec[], styles: StyleSpec[]): Map<string, Set<number>> {
  const declared = new Map<string, Set<number>>();
  const styleTypes = new Map(styles.map((style) => [style.styleId, style.type]));
  const linkedStyles = new Map<string, string>();
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
      if (level.lvlRestart !== undefined) {
        // One-based threshold (§ 17.9.10): 0 (never restart) or a level
        // above this one's predecessor. A value of ilvl restates the default
        // and Word drops the level's numbering when it sees it; larger values
        // name this level or a later one, which readers ignore.
        const maxRestart = Math.max(level.ilvl - 1, 0);
        requireInteger(
          level.lvlRestart,
          `${levelPath}/lvlRestart`,
          (maxRestart === 0
            ? 'lvlRestart must be 0 (never restart) at this level'
            : `lvlRestart must be 0 (never restart) or an integer from 1 to ${maxRestart}`) +
            `; omit it to restart after the previous level`,
          0,
          maxRestart,
        );
      }
      if (level.isLgl !== undefined && typeof level.isLgl !== 'boolean') {
        throw new GenerationSpecError('invalid_value', `${levelPath}/isLgl`, 'isLgl must be a boolean');
      }
      if (level.pStyle !== undefined) {
        validateLevelStyleLink(level.pStyle, `${levelPath}/pStyle`, styleTypes, linkedStyles, `${definition.numId}/${level.ilvl}`);
      }
      if (level.lvlJc !== undefined) {
        requireSupportedSchemaEnum(level.lvlJc, `${levelPath}/lvlJc`, 'ST_Jc', LVL_JC_SET);
      }
      if (level.runProps) validateRunProps(level.runProps, `${levelPath}/runProps`);
      if (level.tabs !== undefined) validateTabStops(level.tabs, `${levelPath}/tabs`);
      if (level.indentTwips) {
        if (level.indentTwips.left !== undefined) {
          requireInteger(
            level.indentTwips.left,
            `${levelPath}/indentTwips/left`,
            'Numbering left indentation must be a signed safe integer in the API-representable subset of ST_SignedTwipsMeasure',
          );
        }
        for (const key of ['hanging', 'firstLine'] as const) {
          const value = level.indentTwips[key];
          if (value !== undefined) {
            requireInteger(
              value,
              `${levelPath}/indentTwips/${key}`,
              `Numbering ${key} indentation must be a non-negative safe integer in the API-representable subset of ST_TwipsMeasure`,
              0,
            );
          }
        }
        if (level.indentTwips.hanging !== undefined && level.indentTwips.firstLine !== undefined) {
          throw new GenerationSpecError('invalid_value', `${levelPath}/indentTwips`, 'firstLine and hanging are mutually exclusive');
        }
      }
    });
    declared.set(definition.numId, levels);
  });
  // Additional instances: checked after every definition handle is known, so
  // an instance cannot reuse a later definition's handle either.
  definitions.forEach((definition, index) => {
    const levels = declared.get(definition.numId)!;
    if (definition.instances === undefined) return;
    if (!Array.isArray(definition.instances)) {
      throw new GenerationSpecError('invalid_value', `/numbering/${index}/instances`, 'instances must be an array');
    }
    definition.instances.forEach((instance, instanceIndex) => {
      const instancePath = `/numbering/${index}/instances/${instanceIndex}`;
      if (typeof instance !== 'object' || instance === null) {
        throw new GenerationSpecError('invalid_value', instancePath, 'Numbering instances must be objects');
      }
      if (!instance.numId) {
        throw new GenerationSpecError('invalid_value', `${instancePath}/numId`, 'Numbering instances require a numId handle');
      }
      if (declared.has(instance.numId)) {
        throw new GenerationSpecError('invalid_value', `${instancePath}/numId`, `Duplicate numbering handle '${instance.numId}'`);
      }
      validateLevelOverrides(instance.levelOverrides, `${instancePath}/levelOverrides`, levels, definition.numId);
      declared.set(instance.numId, levels);
    });
  });
  return declared;
}

/**
 * A level's linked style must be a declared paragraph style, linked by no
 * other level: one style cannot start two numbering levels.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.23
 */
function validateLevelStyleLink(
  styleId: unknown,
  path: string,
  styleTypes: ReadonlyMap<string, StyleSpec['type']>,
  linkedStyles: Map<string, string>,
  levelKey: string,
): void {
  if (typeof styleId !== 'string' || styleId.length === 0) {
    throw new GenerationSpecError('invalid_value', path, 'pStyle must be a non-empty styleId');
  }
  const type = styleTypes.get(styleId);
  if (type === undefined) {
    throw new GenerationSpecError(
      'dangling_style_reference',
      path,
      `Numbering level links undeclared style '${styleId}'; pStyle must name a style declared in DocumentSpec.styles`,
    );
  }
  if (type !== 'paragraph') {
    throw new GenerationSpecError('invalid_value', path, `Numbering level links '${styleId}', which is not a paragraph style`);
  }
  const previous = linkedStyles.get(styleId);
  if (previous !== undefined) {
    throw new GenerationSpecError(
      'invalid_value',
      path,
      `Style '${styleId}' is already linked to numbering level ${previous}; a style links to at most one level`,
    );
  }
  linkedStyles.set(styleId, levelKey);
}

/**
 * An additional instance restarts at least one declared level, each at most
 * once (CT_Num allows at most nine overrides, one per level).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.8
 * @conformance ECMA-376 edition 5, Part 1 § 17.9.26
 */
function validateLevelOverrides(overrides: unknown, path: string, levels: ReadonlySet<number>, definitionId: string): void {
  if (!Array.isArray(overrides) || overrides.length === 0) {
    throw new GenerationSpecError(
      'invalid_value',
      path,
      "Numbering instances require at least one level override; without one an instance only continues the definition's shared sequence",
    );
  }
  const seen = new Set<number>();
  overrides.forEach((override: { ilvl?: unknown; startOverride?: unknown } | null, overrideIndex) => {
    const overridePath = `${path}/${overrideIndex}`;
    if (typeof override !== 'object' || override === null) {
      throw new GenerationSpecError('invalid_value', overridePath, 'Level overrides must be objects');
    }
    const ilvl = override.ilvl;
    if (typeof ilvl !== 'number' || !levels.has(ilvl)) {
      throw new GenerationSpecError(
        'dangling_numbering_reference',
        `${overridePath}/ilvl`,
        `Level override names ilvl ${String(ilvl)}, which numbering '${definitionId}' does not declare`,
      );
    }
    if (seen.has(ilvl)) {
      throw new GenerationSpecError('invalid_value', `${overridePath}/ilvl`, `Duplicate level override for ilvl ${ilvl}`);
    }
    seen.add(ilvl);
    requireInteger(
      override.startOverride,
      `${overridePath}/startOverride`,
      'startOverride must be a signed safe integer in the API-representable subset of ST_DecimalNumber',
    );
  });
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

/**
 * A section whose w:sectPr binds to its last paragraph must end with one: a
 * paragraph-level sectPr cannot sit on a table.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 */
function validateBreakPlacement(section: SectionSpec, path: string, isFinal: boolean): void {
  const placement = section.breakPlacement;
  if (placement === undefined) return;
  if (placement !== 'ownParagraph' && placement !== 'lastParagraph') {
    throw new GenerationSpecError('invalid_value', `${path}/breakPlacement`, `Unsupported section break placement '${String(placement)}'`);
  }
  if (placement === 'lastParagraph' && !isFinal && section.blocks.at(-1)?.kind !== 'paragraph') {
    throw new GenerationSpecError(
      'invalid_value',
      `${path}/breakPlacement`,
      "breakPlacement 'lastParagraph' requires the section to end with a paragraph",
    );
  }
}

/**
 * Story kind: drafting notes may only anchor in the body story, footnote
 * references may only sit in the body story, and a footnote's own paragraphs
 * form the 'footnote' story.
 */
type StoryContext = 'body' | 'headerFooter' | 'footnote';

/** Whether any body block, table cells included, holds a footnote. */
export function specHasFootnotes(spec: DocumentSpec): boolean {
  return spec.sections.some((section) => Array.isArray(section.blocks) && section.blocks.some(blockHasFootnote));
}

function blockHasFootnote(block: BlockSpec): boolean {
  if (block?.kind === 'paragraph') return Array.isArray(block.runs) && block.runs.some((run) => run?.kind === 'footnote');
  if (block?.kind === 'table') {
    return Array.isArray(block.rows) && block.rows.some((row) => Array.isArray(row?.cells)
      && row.cells.some((cell) => Array.isArray(cell?.blocks) && cell.blocks.some(blockHasFootnote)));
  }
  return false;
}

/**
 * A document with footnotes gets the FootnoteText paragraph style and the
 * FootnoteReference character style unless it declares them; a declaration
 * under either id must then have that style type, because the compiler
 * applies it as one.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 */
function validateFootnoteStyles(styles: StyleSpec[]): void {
  const expected: Array<[string, StyleSpec['type']]> = [
    [FOOTNOTE_TEXT_STYLE_ID, 'paragraph'],
    [FOOTNOTE_REFERENCE_STYLE_ID, 'character'],
  ];
  for (const [styleId, type] of expected) {
    const index = styles.findIndex((style) => style.styleId === styleId);
    if (index !== -1 && styles[index]!.type !== type) {
      throw new GenerationSpecError(
        'invalid_value',
        `/styles/${index}/type`,
        `Style '${styleId}' is applied to footnotes as a ${type} style, so it must be declared with type '${type}'`,
      );
    }
  }
}

/**
 * A footnote's body: one or more paragraphs, validated as their own story.
 * A footnote reference may not appear inside a footnote (§ 17.11.14), and the
 * body cannot carry a drafting note or force a page break.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.10
 * @conformance ECMA-376 edition 5, Part 1 § 17.11.14
 */
function validateFootnote(
  footnote: FootnoteSpec,
  path: string,
  styleIds: Set<string>,
  numbering: Map<string, Set<number>>,
  story: StoryContext,
): void {
  if (story === 'headerFooter') {
    throw new GenerationSpecError(
      'invalid_value',
      path,
      'Footnote references may appear only in the body story, not in headers or footers',
    );
  }
  if (story === 'footnote') {
    throw new GenerationSpecError('invalid_value', path, 'A footnote cannot contain another footnote');
  }
  if (!Array.isArray(footnote.blocks) || footnote.blocks.length === 0) {
    throw new GenerationSpecError('invalid_value', `${path}/blocks`, 'A footnote needs at least one paragraph');
  }
  footnote.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}/blocks/${blockIndex}`;
    if (block?.kind !== 'paragraph') {
      throw new GenerationSpecError(
        'unsupported_feature',
        blockPath,
        `Footnote blocks must be paragraphs; block kind '${String((block as { kind?: unknown } | undefined)?.kind)}' is not supported in a footnote`,
      );
    }
    if (block.pageBreakBefore) {
      throw new GenerationSpecError('invalid_value', `${blockPath}/pageBreakBefore`, 'A footnote paragraph cannot start a new page');
    }
    validateParagraph(block, blockPath, styleIds, numbering, 'footnote');
  });
}

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
    if (story !== 'body') {
      throw new GenerationSpecError(
        'invalid_value',
        `${path}/note`,
        story === 'footnote'
          ? 'Drafting notes anchor as document-story comments and cannot live in footnotes'
          : 'Drafting notes anchor as document-story comments and cannot live in headers or footers',
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
    validateInline(run, `${path}/runs/${runIndex}`, styleIds, numbering, story);
  });
}

type ParagraphProperties = NonNullable<StyleSpec['paragraph']>;

/** Validate the paragraph-property subset shared by body paragraphs and styles. */
function validateParagraphProps(props: ParagraphProperties, path: string): void {
  if (props.borders) validateBorders(props.borders, `${path}/borders`);
  if (props.tabs) validateTabStops(props.tabs, `${path}/tabs`);
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

/** Tab stops shared by paragraphs, styles, and numbering levels. */
function validateTabStops(tabs: TabStopSpec[], path: string): void {
  if (!Array.isArray(tabs)) {
    throw new GenerationSpecError('invalid_value', path, 'tabs must be an array of tab stops');
  }
  tabs.forEach((stop, i) => {
    if (typeof stop !== 'object' || stop === null) {
      throw new GenerationSpecError('invalid_value', `${path}/${i}`, 'Tab stops must be objects');
    }
    requireInteger(stop.posTwips, `${path}/${i}/posTwips`, 'Tab stop position must be a non-negative safe integer in twips', 0);
    if (!TAB_ALIGNMENTS.has(stop.align)) throw new GenerationSpecError('invalid_value', `${path}/${i}/align`, `Unsupported tab alignment '${stop.align}'`);
    if (stop.leader !== undefined && !TAB_LEADERS.has(stop.leader)) throw new GenerationSpecError('invalid_value', `${path}/${i}/leader`, `Unsupported tab leader '${stop.leader}'`);
  });
}

function validateInline(
  run: InlineSpec,
  path: string,
  styleIds: Set<string>,
  numbering: Map<string, Set<number>>,
  story: StoryContext,
): void {
  if (run.kind !== 'tab' && run.kind !== 'break' && run.kind !== 'field' && run.kind !== 'text' && run.kind !== 'footnote' && run.kind !== 'crossReference') {
    unsupported(path, `inline kind '${(run as { kind: string }).kind}'`);
  }
  if (run.kind === 'crossReference') {
    if (typeof run.bookmark !== 'string' || run.bookmark.length === 0) {
      throw new GenerationSpecError('invalid_value', `${path}/bookmark`, 'Cross-references name a bookmark');
    }
    if (run.show !== undefined && !CROSS_REFERENCE_SHOW_SET.has(run.show)) {
      throw new GenerationSpecError('invalid_value', `${path}/show`, `Cross-reference show must be one of ${CROSS_REFERENCE_SHOWS.join(', ')}, got '${String(run.show)}'`);
    }
    if (run.show === 'text' && run.number !== undefined) {
      throw new GenerationSpecError('invalid_value', `${path}/number`, 'A text cross-reference shows no number; drop number or show the number');
    }
    if (run.show === 'text') {
      // Word writes a text reference's result as the target's runs with their
      // own formatting, whatever formatting the field carries (#1259 Word
      // evidence), so formatting on the reference would vanish on update.
      const formatting = Object.keys(run).filter((key) => key !== 'kind' && key !== 'bookmark' && key !== 'show' && key !== 'number');
      if (formatting.length > 0) {
        throw new GenerationSpecError(
          'invalid_value',
          `${path}/${formatting[0]}`,
          'A text cross-reference takes its target\'s formatting: Word replaces its result with the target\'s runs when fields update, so it carries no run formatting of its own',
        );
      }
    }
    if (run.number !== undefined && !CROSS_REFERENCE_NUMBER_SET.has(run.number)) {
      throw new GenerationSpecError('invalid_value', `${path}/number`, `Cross-reference number must be one of ${CROSS_REFERENCE_NUMBERS.join(', ')}, got '${String(run.number)}'`);
    }
    validateRunProps(run, path);
    return;
  }
  if (run.kind === 'footnote') {
    validateFootnote(run, path, styleIds, numbering, story);
    return;
  }
  if (run.kind === 'break' && run.breakType === 'page' && story === 'footnote') {
    throw new GenerationSpecError('invalid_value', `${path}/breakType`, 'A footnote cannot contain a page break');
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
  if (props.font !== undefined && (typeof props.font !== 'string' || props.font.trim().length === 0)) {
    throw new GenerationSpecError('invalid_value', `${path}/font`, 'font must be a non-empty typeface name');
  }
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
