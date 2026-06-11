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
 * As phase PRs land emitters, their features move from the rejection list to
 * the supported set in the same PR.
 */

import { GenerationSpecError } from './errors.js';
import type { DocumentSpec, InlineSpec, ParagraphSpec, RunProps, SectionSpec } from './types.js';

const RUN_PROP_KEYS: ReadonlyArray<keyof RunProps> = [
  'bold',
  'italic',
  'underline',
  'colorHex',
  'font',
  'sizePt',
  'caps',
  'smallCaps',
];

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

  if (spec.styles && spec.styles.length > 0) unsupported('/styles', 'styles');
  if (spec.numbering && spec.numbering.length > 0) unsupported('/numbering', 'numbering');
  if (spec.sections.length > 1) unsupported('/sections', 'multiple sections');

  spec.sections.forEach((section, sectionIndex) => {
    validateSection(section, `/sections/${sectionIndex}`);
  });
}

function validateSection(section: SectionSpec, path: string): void {
  if (section.breakType) unsupported(`${path}/breakType`, 'section break type');
  if (section.pageNumbering) unsupported(`${path}/pageNumbering`, 'page numbering');
  if (section.titlePg) unsupported(`${path}/titlePg`, 'title page header/footer');
  if (section.headers) unsupported(`${path}/headers`, 'headers');
  if (section.footers) unsupported(`${path}/footers`, 'footers');

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
    validateParagraph(block, blockPath);
  });
}

function validateParagraph(paragraph: ParagraphSpec, path: string): void {
  if (paragraph.styleId !== undefined) unsupported(`${path}/styleId`, 'named paragraph styles');
  if (paragraph.alignment !== undefined) unsupported(`${path}/alignment`, 'paragraph alignment');
  if (paragraph.spacing !== undefined) unsupported(`${path}/spacing`, 'paragraph spacing');
  if (paragraph.indent !== undefined) unsupported(`${path}/indent`, 'paragraph indentation');
  if (paragraph.list !== undefined) unsupported(`${path}/list`, 'numbered lists');
  if (paragraph.pageBreakBefore !== undefined) unsupported(`${path}/pageBreakBefore`, 'page break before');
  if (paragraph.keepNext !== undefined) unsupported(`${path}/keepNext`, 'keep with next');
  if (paragraph.tabs !== undefined) unsupported(`${path}/tabs`, 'tab stops');
  if (paragraph.note !== undefined) unsupported(`${path}/note`, 'drafting notes');

  if (!Array.isArray(paragraph.runs)) {
    throw new GenerationSpecError('invalid_value', `${path}/runs`, 'Paragraph runs must be an array');
  }
  paragraph.runs.forEach((run, runIndex) => {
    validateInline(run, `${path}/runs/${runIndex}`);
  });
}

function validateInline(run: InlineSpec, path: string): void {
  if (run.kind === 'field') unsupported(path, 'field codes');
  if (run.kind === 'tab') unsupported(path, 'tab runs');
  if (run.kind === 'break') unsupported(path, 'break runs');

  if (typeof run.text !== 'string') {
    throw new GenerationSpecError('invalid_value', `${path}/text`, 'Text runs must carry a string');
  }
  for (const key of RUN_PROP_KEYS) {
    if (run[key] !== undefined) unsupported(`${path}/${key}`, `run formatting '${key}'`);
  }
}
