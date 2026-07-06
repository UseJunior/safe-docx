/**
 * word/settings.xml emitter.
 *
 * Emitted on every package. The part always carries a `w:compat` block with a
 * `compatibilityMode=15` compatSetting (Word 2013+ / mode 15) so Microsoft Word
 * opens generated documents in the current format rather than the legacy
 * "Compatibility Mode" (which shows a banner in the title bar). Conditional
 * settings are folded in when the document needs them: `w:evenAndOddHeaders`
 * for any section declaring an even-page header or footer, and
 * `w:clrSchemeMapping` when theme-relative authoring or a custom theme is used.
 *
 * The `w:compat` block is static (no clock/random), preserving the compiler's
 * byte-for-byte determinism guarantee.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 */

import { createWmlElement } from '../../primitives/dom-helpers.js';
import { OOXML, W } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { BlockSpec, DocumentSpec, InlineSpec, TableCellSpec } from '../types.js';

const SETTINGS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

/** Word 2013+ compatibility mode; clears Word's legacy "Compatibility Mode" banner. */
const COMPATIBILITY_MODE_15 = '15';
const COMPAT_SETTING_URI = 'http://schemas.microsoft.com/office/word';

export function emitSettingsPart(spec: DocumentSpec, ctx: CompileContext): void {
  const needsEvenOdd = spec.sections.some((s) => s.headers?.even || s.footers?.even);
  const needsColorSchemeMapping = spec.theme !== undefined || usesThemeRelativeAuthoring(spec);

  ctx.registerPart('word/settings.xml', SETTINGS_CONTENT_TYPE, SETTINGS_REL_TYPE);
  const doc = parseXml(`<w:settings xmlns:w="${OOXML.W_NS}"/>`);
  // CT_Settings sequence: evenAndOddHeaders and clrSchemeMapping precede compat.
  if (needsEvenOdd) {
    doc.documentElement!.appendChild(createWmlElement(doc, W.evenAndOddHeaders));
  }
  if (needsColorSchemeMapping) {
    doc.documentElement!.appendChild(
      createWmlElement(doc, W.clrSchemeMapping, {
        'w:bg1': 'light1',
        'w:t1': 'dark1',
        'w:bg2': 'light2',
        'w:t2': 'dark2',
        'w:accent1': 'accent1',
        'w:accent2': 'accent2',
        'w:accent3': 'accent3',
        'w:accent4': 'accent4',
        'w:accent5': 'accent5',
        'w:accent6': 'accent6',
        'w:hyperlink': 'hyperlink',
        'w:followedHyperlink': 'followedHyperlink',
      }),
    );
  }
  const compat = createWmlElement(doc, W.compat);
  compat.appendChild(
    createWmlElement(doc, W.compatSetting, {
      'w:name': 'compatibilityMode',
      'w:uri': COMPAT_SETTING_URI,
      'w:val': COMPATIBILITY_MODE_15,
    }),
  );
  doc.documentElement!.appendChild(compat);
  ctx.setFileContent('word/settings.xml', XML_DECL + serializeXml(doc));
}

function usesThemeRelativeAuthoring(spec: DocumentSpec): boolean {
  if (spec.styles?.some((style) => style.run?.themeColor !== undefined)) return true;
  if (spec.numbering?.some((numbering) => numbering.levels.some((level) => level.runProps?.themeColor !== undefined))) return true;
  return spec.sections.some((section) => {
    const blocks = [
      ...section.blocks,
      ...Object.values(section.headers ?? {}).flatMap((story) => story?.blocks ?? []),
      ...Object.values(section.footers ?? {}).flatMap((story) => story?.blocks ?? []),
    ];
    return blocks.some(blockUsesThemeRelativeAuthoring);
  });
}

function blockUsesThemeRelativeAuthoring(block: BlockSpec): boolean {
  if (block.kind === 'paragraph') return block.runs.some(inlineUsesThemeRelativeAuthoring);
  return block.rows.some((row) => row.cells.some(cellUsesThemeRelativeAuthoring));
}

function inlineUsesThemeRelativeAuthoring(inline: InlineSpec): boolean {
  return (inline.kind === 'text' || inline.kind === 'field') && inline.themeColor !== undefined;
}

function cellUsesThemeRelativeAuthoring(cell: TableCellSpec): boolean {
  return cell.themeFill !== undefined || cell.blocks.some(blockUsesThemeRelativeAuthoring);
}
