import { DocxDocument, computeContentFingerprint, getParagraphRuns } from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';

export type NormalizedRun = {
  text: string;
  start: number;
  end: number;
  runPropertySha256: string;
  sourceRunCount: number;
};

export type InspectionRecord = {
  id: string;
  fingerprint: string;
  text: string;
  paragraphStyleId: string | null;
  alignment: string;
  indentsPt: { left: number; firstLine: number };
  bodyRunFormatting: unknown;
  paragraphPropertySha256: string;
  normalizedRuns: NormalizedRun[];
  tableContext?: unknown;
  footnoteRefs?: Array<{ id: number; display: number }>;
};

function directPropertyXml(element: Element, localName: 'pPr' | 'rPr'): string {
  return Array.from(element.childNodes)
    .find((child): child is Element => child.nodeType === 1 && (child as Element).localName === localName)
    ?.toString() ?? '';
}

function normalizedRuns(paragraph: Element): NormalizedRun[] {
  const result: NormalizedRun[] = [];
  let offset = 0;
  for (const run of getParagraphRuns(paragraph).filter((candidate) => candidate.text.length > 0)) {
    const propertyHash = sha256(directPropertyXml(run.r, 'rPr'));
    const previous = result[result.length - 1];
    if (previous?.runPropertySha256 === propertyHash) {
      previous.text += run.text;
      previous.end += run.text.length;
      previous.sourceRunCount += 1;
    } else {
      result.push({ text: run.text, start: offset, end: offset + run.text.length, runPropertySha256: propertyHash, sourceRunCount: 1 });
    }
    offset += run.text.length;
  }
  return result;
}

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
    .map((node) => {
      const paragraph = document.getParagraphElementById(node.id);
      if (!paragraph) throw new DocxMarkdocError('UNKNOWN_INSPECTION_ANCHOR', `Unknown paragraph ID: ${node.id}`);
      return {
      id: node.id,
      fingerprint: computeContentFingerprint(node.raw_text ?? node.text),
      text: node.raw_text ?? node.text,
      paragraphStyleId: node.paragraph_style_id,
      alignment: node.paragraph_alignment,
      indentsPt: { left: node.paragraph_indents_pt.left, firstLine: node.paragraph_indents_pt.first_line },
      bodyRunFormatting: node.body_run_formatting,
      paragraphPropertySha256: sha256(directPropertyXml(paragraph, 'pPr')),
      normalizedRuns: normalizedRuns(paragraph),
      tableContext: node.table_context,
      footnoteRefs: node.footnote_refs,
      };
    });
  if (requested && records.length !== requested.size) {
    const found = new Set(records.map((record) => record.id));
    const missing = [...requested].filter((id) => !found.has(id));
    throw new DocxMarkdocError('UNKNOWN_INSPECTION_ANCHOR', `Unknown paragraph IDs: ${missing.join(', ')}`);
  }
  return records;
}
