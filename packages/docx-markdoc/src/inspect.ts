import { DocxDocument, computeContentFingerprint } from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';

export type InspectionRecord = {
  id: string;
  fingerprint: string;
  text: string;
  paragraphStyleId: string | null;
  alignment: string;
  indentsPt: { left: number; firstLine: number };
  bodyRunFormatting: unknown;
  tableContext?: unknown;
  footnoteRefs?: Array<{ id: number; display: number }>;
};

export async function inspectMarkdocSource(
  source: Buffer,
  options: { paragraphIds?: string[] } = {},
): Promise<InspectionRecord[]> {
  const document = await DocxDocument.load(source);
  const { nodes } = document.buildDocumentView({
    includeSemanticTags: false,
    showFormatting: true,
    formattingMode: 'full',
  });
  const requested = options.paragraphIds ? new Set(options.paragraphIds) : null;
  const records = nodes
    .filter((node) => !requested || requested.has(node.id))
    .map((node) => ({
      id: node.id,
      fingerprint: computeContentFingerprint(node.raw_text ?? node.text),
      text: node.raw_text ?? node.text,
      paragraphStyleId: node.paragraph_style_id,
      alignment: node.paragraph_alignment,
      indentsPt: { left: node.paragraph_indents_pt.left, firstLine: node.paragraph_indents_pt.first_line },
      bodyRunFormatting: node.body_run_formatting,
      tableContext: node.table_context,
      footnoteRefs: node.footnote_refs,
    }));
  if (requested && records.length !== requested.size) {
    const found = new Set(records.map((record) => record.id));
    const missing = [...requested].filter((id) => !found.has(id));
    throw new DocxMarkdocError('UNKNOWN_INSPECTION_ANCHOR', `Unknown paragraph IDs: ${missing.join(', ')}`);
  }
  return records;
}
