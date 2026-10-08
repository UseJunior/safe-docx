import {type Node} from '@markdoc/markdoc';

/**
 * Acronym segments that keep their conventional casing when a snake_case
 * field name is humanized into a display label (#2279): `nda_term` → "NDA
 * Term", never "Nda Term". Keyed by the lower-cased name segment; the value
 * is the rendered form (which lets `soc2` render as "SOC 2").
 *
 * The list is the union of the acronym segments that actually occur in
 * template/agreement field names (swept across all rendered template pages)
 * and the short future-proofing set the issue pins. Deliberately absent: the
 * Common Paper DPA's `pd_`/`pa_`/`sm_` prefixes — those are abbreviations of
 * "personal data" / "processing activities" / "security measures", and
 * upper-casing them ("PD Contact") would not make the label clearer.
 */
const FIELD_LABEL_ACRONYMS: ReadonlyMap<string, string> = new Map<string, string>([
  ...[
    'NDA', 'MNDA', 'AI', 'SAFE', 'MSA', 'PSA', 'SOW', 'API', 'IP', 'URL',
    'ID', 'LLC', 'LLP', 'CIIAA', 'SLA', 'CSA', 'DPA', 'BAA', 'LOI', 'ROFR',
    'HIPAA', 'CCPA', 'GDPR', 'ISO', 'EU', 'UK', 'EEA', 'PCI', 'EO', 'RSPA',
    'MFN', 'NVCA',
  ].map((acronym): [string, string] => [acronym.toLowerCase(), acronym]),
  ['soc2', 'SOC 2'],
]);

/**
 * "party_1_signatory_name" → "Party 1 Signatory Name"; acronym segments keep
 * their conventional casing ("nda_term" → "NDA Term"). Splits on whitespace as
 * well as underscores so it also serves field names that arrive pre-spaced.
 */
function titleCaseSnake(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(
      (part) =>
        FIELD_LABEL_ACRONYMS.get(part.toLowerCase()) ??
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}

function isWhitespaceBlock(node: Node): boolean {
  if (node.type !== 'paragraph' && node.type !== 'inline') return false;
  return !hasRenderableContent(node);
}

/**
 * Whether a paragraph/inline carries anything that must render. Empty text and
 * line breaks do not count; any image/tag/code/emphasis/non-empty text does — so
 * an image-only paragraph is NOT treated as whitespace and still reaches the
 * throw-on-unknown path rather than being silently skipped.
 */
function hasRenderableContent(node: Node): boolean {
  if (node.type === 'text') return String(node.attributes.content ?? '').trim() !== '';
  if (node.type === 'softbreak' || node.type === 'hardbreak') return false;
  if (node.type === 'inline' || node.type === 'paragraph') {
    return (node.children ?? []).some((child) => hasRenderableContent(child as Node));
  }
  return true;
}

function plainText(node: Node): string {
  if (node.type === 'text') return String(node.attributes.content ?? '');
  if (node.type === 'softbreak' || node.type === 'hardbreak') return ' ';
  return (node.children ?? []).map((child) => plainText(child as Node)).join('');
}

/**
 * Thrown when the engine meets a Markdoc node or tag no renderer branch or
 * plugin handles. Rendering fails loudly rather than dropping source content.
 */
export class MarkdocxUnhandledNodeError extends Error {
  readonly nodeType: string;
  readonly tag?: string;

  constructor(node: Node) {
    const what = node.type === 'tag' ? `tag {% ${String(node.tag)} %}` : `node "${node.type}"`;
    super(`Unhandled Markdoc ${what} in the markdocx renderer. Add a block or inline tag plugin (or a renderer branch) or the rendered document will drift from the source.`);
    this.name = 'MarkdocxUnhandledNodeError';
    this.nodeType = node.type;
    if (node.type === 'tag') this.tag = String(node.tag);
  }
}

function throwUnhandledTag(node: Node): never {
  throw new MarkdocxUnhandledNodeError(node);
}

function throwUnhandledBlock(node: Node): never {
  throw new MarkdocxUnhandledNodeError(node);
}

export {
  throwUnhandledBlock,
  throwUnhandledTag,
  hasRenderableContent,
  plainText,
  isWhitespaceBlock,
  titleCaseSnake,
  FIELD_LABEL_ACRONYMS,
};
