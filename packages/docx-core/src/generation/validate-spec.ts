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
 * documents with per-section page setup, page numbering, break types, and
 * default/first/even headers and footers.
 * Still rejected: numbering, tables, drafting notes.
 */

import { GenerationSpecError } from './errors.js';
import type { DocumentSpec, InlineSpec, ParagraphSpec, RunProps, SectionSpec, StyleSpec } from './types.js';

const COLOR_HEX_RE = /^[0-9A-Fa-f]{6}$/;

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

  if (spec.numbering && spec.numbering.length > 0) unsupported('/numbering', 'numbering');

  const declaredStyleIds = validateStyles(spec.styles ?? []);

  spec.sections.forEach((section, sectionIndex) => {
    validateSection(section, `/sections/${sectionIndex}`, declaredStyleIds);
  });
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

function validateSection(section: SectionSpec, path: string, styleIds: Set<string>): void {
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
        const blockPath = `${slotPath}/blocks/${blockIndex}`;
        if (block.kind === 'table') unsupported(blockPath, 'tables');
        validateParagraph(block, blockPath, styleIds);
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
    const blockPath = `${path}/blocks/${blockIndex}`;
    if (block.kind === 'table') unsupported(blockPath, 'tables');
    validateParagraph(block, blockPath, styleIds);
  });
}

function validateParagraph(paragraph: ParagraphSpec, path: string, styleIds: Set<string>): void {
  if (paragraph.list !== undefined) unsupported(`${path}/list`, 'numbered lists');
  if (paragraph.note !== undefined) unsupported(`${path}/note`, 'drafting notes');

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
}
