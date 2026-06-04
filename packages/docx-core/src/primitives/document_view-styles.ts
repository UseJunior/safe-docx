import { LabelType } from './list_labels.js';
import type { DocumentStyleInfo, DocumentStyles, DocumentViewNode, FormattingFingerprint } from './document_view-types.js';

export type { DocumentStyleInfo, DocumentStyles, FormattingFingerprint } from './document_view-types.js';

const STYLE_EXAMPLE_TEXT_PREVIEW_LENGTH = 50;

export function fingerprintKey(fp: FormattingFingerprint): string {
  // Stable JSON-ish key used for Map lookups.
  return `${fp.list_level}|${fp.left_indent_pt.toFixed(1)}|${fp.first_line_indent_pt.toFixed(1)}|${fp.style_name}|${fp.alignment}`;
}

/**
 * v0.3: Compact style fingerprint token.
 * Concatenates style name, list level, alignment, and indentation for token-efficient LLM context.
 * Example: "Normal:L-1:LEFT:I0:H0"
 */
export function computeFingerprintToken(fp: FormattingFingerprint, styleId?: string): string {
  const name = styleId || fp.style_name || 'body';
  const level = `L${fp.list_level}`;
  const align = fp.alignment;
  const indent = `I${Math.round(fp.left_indent_pt)}`;
  const hanging = `H${Math.round(fp.first_line_indent_pt)}`;
  return `${name}:${level}:${align}:${indent}:${hanging}`;
}

function inferSemanticName(params: {
  fp: FormattingFingerprint;
  nodes: DocumentViewNode[];
}): { base_id: string; display_name: string } {
  const { fp, nodes } = params;

  // Find first label_type if present.
  let labelType: LabelType | null = null;
  for (const n of nodes) {
    if (n.list_metadata.label_type) {
      labelType = n.list_metadata.label_type;
      break;
    }
  }

  const listLevel = fp.list_level;

  if (listLevel >= 0) {
    if (listLevel === 0) {
      if (labelType === LabelType.ARTICLE) return { base_id: 'article', display_name: 'Article Heading' };
      if (labelType === LabelType.SECTION) return { base_id: 'section', display_name: 'Section Heading' };
      if (labelType === LabelType.ROMAN) return { base_id: 'roman_section', display_name: 'Roman Numeral Section' };
      return { base_id: 'top_level', display_name: 'Top-Level List Item' };
    }
    if (listLevel === 1) {
      if (labelType === LabelType.LETTER) return { base_id: 'subsection', display_name: 'Subsection (a)/(A)' };
      if (labelType === LabelType.NUMBER) return { base_id: 'subsection_number', display_name: 'Numbered Subsection' };
      if (labelType === LabelType.ROMAN) return { base_id: 'subsection_roman', display_name: 'Roman Subsection' };
      return { base_id: 'level_1', display_name: `Level ${listLevel} List Item` };
    }
    if (labelType === LabelType.ROMAN) return { base_id: `level_${listLevel}_roman`, display_name: `Level ${listLevel} Roman` };
    if (labelType === LabelType.LETTER) return { base_id: `level_${listLevel}_letter`, display_name: `Level ${listLevel} Letter` };
    return { base_id: `level_${listLevel}`, display_name: `Level ${listLevel} List Item` };
  }

  // Non-list.
  const styleName = fp.style_name.toLowerCase().replace(/\s+/g, '_');
  if (fp.left_indent_pt > 0) return { base_id: 'indent_block', display_name: 'Indented Block' };
  if (styleName.includes('heading') || styleName.includes('title')) return { base_id: 'heading', display_name: 'Heading' };
  if (styleName.includes('quote') || styleName.includes('block')) return { base_id: 'block_quote', display_name: 'Block Quote' };
  return { base_id: 'body', display_name: 'Body Text' };
}

export function discoverStyles(nodes: DocumentViewNode[]): DocumentStyles {
  const groups = new Map<string, { fp: FormattingFingerprint; nodes: DocumentViewNode[] }>();
  for (const n of nodes) {
    const key = fingerprintKey(n.style_fingerprint);
    const g = groups.get(key);
    if (g) g.nodes.push(n);
    else groups.set(key, { fp: n.style_fingerprint, nodes: [n] });
  }

  const used: Record<string, number> = {};
  const styles = new Map<string, DocumentStyleInfo>();
  const fpToStyle = new Map<string, string>();

  for (const [fpKey, g] of groups.entries()) {
    const { base_id, display_name } = inferSemanticName({ fp: g.fp, nodes: g.nodes });
    let styleId = base_id;
    if (used[base_id] !== undefined) {
      used[base_id] += 1;
      styleId = `${base_id}_${used[base_id]}`;
    } else {
      used[base_id] = 0;
    }

    const median = g.nodes[Math.floor(g.nodes.length / 2)]!;
    const info: DocumentStyleInfo = {
      style_id: styleId,
      display_name,
      fingerprint: g.fp,
      example_node_id: median.id,
      example_text: median.clean_text.slice(0, STYLE_EXAMPLE_TEXT_PREVIEW_LENGTH),
      count: g.nodes.length,
      dominant_alignment: g.fp.alignment,
    };
    styles.set(styleId, info);
    fpToStyle.set(fpKey, styleId);
  }

  return { styles, fingerprint_to_style: fpToStyle };
}
