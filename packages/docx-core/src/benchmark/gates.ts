/**
 * Quality benchmark gates.
 *
 * G1: Text round-trip (HARD) — 3 sub-checks
 * G2: Formatting projection (SOFT / diagnostic in v1)
 * G3: Structural integrity (HARD)
 */

import { parseXml } from '../primitives/xml.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  compareTexts,
  extractTextWithParagraphs,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import {
  validateNumberingIntegrity,
  validateNoteIntegrity,
  validateBookmarkIntegrity,
} from '../shared/validators/structural.js';
import { DocxArchive, DOCX_PATHS } from '../shared/docx/DocxArchive.js';
import { cleanupInternalBookmarks, insertParagraphBookmarks, getParagraphBookmarkId } from '../primitives/bookmarks.js';
import { buildNodesForDocumentView } from '../primitives/document_view.js';
import { parseDocumentRels } from '../primitives/relationships.js';
import { OOXML } from '../primitives/namespaces.js';
import type {
  G1TextRoundTripResult,
  GateResult,
  GateResults,
} from './types.js';

// ── G1: Text round-trip (HARD) ─────────────────────────────────────

export function gateTextRoundTrip(
  resultDocumentXml: string,
  originalText: string,
  revisedText: string,
): G1TextRoundTripResult {
  // G1c: XML parse validity
  try {
    parseXml(resultDocumentXml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      xmlParseValidity: { passed: false, detail: `XML parse error: ${msg}` },
      normalizedTextParity: { passed: false, detail: 'Skipped (XML parse failed)' },
      paragraphCountParity: { passed: false, detail: 'Skipped (XML parse failed)' },
    };
  }
  const g1c = { passed: true, detail: 'Valid XML' };

  // G1a: Normalized text parity
  let acceptedXml: string;
  let rejectedXml: string;
  try {
    acceptedXml = acceptAllChanges(resultDocumentXml);
    rejectedXml = rejectAllChanges(resultDocumentXml);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      xmlParseValidity: g1c,
      normalizedTextParity: { passed: false, detail: `Accept/reject failed: ${msg}` },
      paragraphCountParity: { passed: false, detail: 'Skipped (accept/reject failed)' },
    };
  }

  const acceptedText = extractTextWithParagraphs(acceptedXml);
  const rejectedText = extractTextWithParagraphs(rejectedXml);

  const acceptComparison = compareTexts(revisedText, acceptedText);
  const rejectComparison = compareTexts(originalText, rejectedText);

  const acceptOk = acceptComparison.normalizedIdentical;
  const rejectOk = rejectComparison.normalizedIdentical;

  let g1aDetail: string;
  if (acceptOk && rejectOk) {
    g1aDetail = 'Accept → revised and reject → original both match';
  } else {
    const parts: string[] = [];
    if (!acceptOk) {
      parts.push(`accept mismatch (expected=${acceptComparison.expectedLength}, actual=${acceptComparison.actualLength})`);
    }
    if (!rejectOk) {
      parts.push(`reject mismatch (expected=${rejectComparison.expectedLength}, actual=${rejectComparison.actualLength})`);
    }
    g1aDetail = parts.join('; ');
  }
  const g1a = { passed: acceptOk && rejectOk, detail: g1aDetail };

  // G1b: Paragraph count parity
  // Count non-empty text lines as proxy for paragraphs (extractTextWithParagraphs
  // produces one line per w:p with visible text).
  const revisedParaLines = revisedText.split('\n').filter((l) => l.length > 0).length;
  const originalParaLines = originalText.split('\n').filter((l) => l.length > 0).length;
  const acceptedParaLines = acceptedText.split('\n').filter((l) => l.length > 0).length;
  const rejectedParaLines = rejectedText.split('\n').filter((l) => l.length > 0).length;

  const acceptParaOk = acceptedParaLines === revisedParaLines;
  const rejectParaOk = rejectedParaLines === originalParaLines;

  let g1bDetail: string;
  if (acceptParaOk && rejectParaOk) {
    g1bDetail = `Paragraph counts match (accepted=${acceptedParaLines}, rejected=${rejectedParaLines})`;
  } else {
    const parts: string[] = [];
    if (!acceptParaOk) {
      parts.push(`accept para count: expected=${revisedParaLines}, actual=${acceptedParaLines}`);
    }
    if (!rejectParaOk) {
      parts.push(`reject para count: expected=${originalParaLines}, actual=${rejectedParaLines}`);
    }
    g1bDetail = parts.join('; ');
  }
  const g1b = { passed: acceptParaOk && rejectParaOk, detail: g1bDetail };

  return {
    xmlParseValidity: g1c,
    normalizedTextParity: g1a,
    paragraphCountParity: g1b,
  };
}

// ── G2: Formatting projection (SOFT) ───────────────────────────────

export async function gateFormattingProjection(
  resultBuffer: Buffer,
  revisedBuffer: Buffer,
  originalBuffer: Buffer,
): Promise<GateResult> {
  try {
    const acceptedProjection = await extractCanonicalProjection(resultBuffer, 'accept');
    const revisedProjection = await extractCanonicalProjection(revisedBuffer, 'identity');

    const rejectedProjection = await extractCanonicalProjection(resultBuffer, 'reject');
    const originalProjection = await extractCanonicalProjection(originalBuffer, 'identity');

    const acceptMismatches: string[] = [];
    const rejectMismatches: string[] = [];

    // Compare accepted projection vs revised
    const maxAcceptLen = Math.max(acceptedProjection.length, revisedProjection.length);
    for (let i = 0; i < maxAcceptLen; i++) {
      const a = acceptedProjection[i];
      const r = revisedProjection[i];
      if (!a || !r) {
        acceptMismatches.push(`paragraph ${i}: missing in ${!a ? 'accepted' : 'revised'}`);
        continue;
      }
      if (a.tagged_text !== r.tagged_text) {
        acceptMismatches.push(`paragraph ${i} (${a.id}): tagged_text differs`);
      }
    }

    // Compare rejected projection vs original
    const maxRejectLen = Math.max(rejectedProjection.length, originalProjection.length);
    for (let i = 0; i < maxRejectLen; i++) {
      const rj = rejectedProjection[i];
      const o = originalProjection[i];
      if (!rj || !o) {
        rejectMismatches.push(`paragraph ${i}: missing in ${!rj ? 'rejected' : 'original'}`);
        continue;
      }
      if (rj.tagged_text !== o.tagged_text) {
        rejectMismatches.push(`paragraph ${i} (${rj.id}): tagged_text differs`);
      }
    }

    const passed = acceptMismatches.length === 0 && rejectMismatches.length === 0;
    const detail = passed
      ? 'Formatting projection matches'
      : `Accept mismatches: ${acceptMismatches.length}, reject mismatches: ${rejectMismatches.length}. First: ${[...acceptMismatches, ...rejectMismatches].slice(0, 3).join('; ')}`;

    return { passed, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { passed: false, detail: `G2 error: ${msg}` };
  }
}

type ProjectionMode = 'accept' | 'reject' | 'identity';

async function extractCanonicalProjection(
  docxBuffer: Buffer,
  mode: ProjectionMode,
): Promise<Array<{ id: string; tagged_text: string }>> {
  const archive = await DocxArchive.load(docxBuffer);
  let documentXmlStr = await archive.getDocumentXml();

  // Apply accept/reject if needed
  if (mode === 'accept') {
    documentXmlStr = acceptAllChanges(documentXmlStr);
  } else if (mode === 'reject') {
    documentXmlStr = rejectAllChanges(documentXmlStr);
  }

  const stylesXmlStr = await archive.getFile(DOCX_PATHS.STYLES);
  const numberingXmlStr = await archive.getFile(DOCX_PATHS.NUMBERING);
  const footnotesXmlStr = await archive.getFile(DOCX_PATHS.FOOTNOTES);
  const relsStr = await archive.getFile(DOCX_PATHS.RELS);

  const doc = parseXml(documentXmlStr);

  // Cleanup existing bookmarks and insert fresh ones
  cleanupInternalBookmarks(doc);
  insertParagraphBookmarks(doc, 'benchmark');

  // Re-walk paragraphs
  const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, 'p'))
    .map((p) => {
      const id = getParagraphBookmarkId(p);
      return id ? { id, p } : null;
    })
    .filter((x): x is { id: string; p: Element } => x !== null);

  const stylesXml = stylesXmlStr ? parseXml(stylesXmlStr) : null;
  const numberingXml = numberingXmlStr ? parseXml(numberingXmlStr) : null;
  const footnotesXml = footnotesXmlStr ? parseXml(footnotesXmlStr) : null;
  const relsMap = relsStr ? parseDocumentRels(parseXml(relsStr)) : undefined;

  const { nodes } = buildNodesForDocumentView({
    paragraphs,
    stylesXml,
    numberingXml,
    show_formatting: true,
    formatting_mode: 'full',
    relsMap,
    documentXml: doc,
    footnotesXml,
  });

  return nodes.map((n) => ({ id: n.id, tagged_text: n.tagged_text }));
}

// ── G3: Structural integrity (HARD) ────────────────────────────────

export async function gateStructuralIntegrity(resultBuffer: Buffer): Promise<GateResult> {
  try {
    const archive = await DocxArchive.load(resultBuffer);
    const documentXml = await archive.getDocumentXml();
    const numberingXml = await archive.getFile(DOCX_PATHS.NUMBERING);
    const footnotesXml = await archive.getFile(DOCX_PATHS.FOOTNOTES);
    const endnotesXml = await archive.getFile(DOCX_PATHS.ENDNOTES);

    const issues: string[] = [];

    const numbering = validateNumberingIntegrity(documentXml, numberingXml);
    if (numbering.missingNumIds.length > 0) {
      issues.push(`Missing numIds: ${numbering.missingNumIds.join(', ')}`);
    }
    if (numbering.missingAbstractNumIds.length > 0) {
      issues.push(`Missing abstractNumIds: ${numbering.missingAbstractNumIds.join(', ')}`);
    }
    if (numbering.invalidLevels.length > 0) {
      issues.push(`Invalid levels: ${numbering.invalidLevels.join(', ')}`);
    }

    const notes = validateNoteIntegrity(documentXml, footnotesXml, endnotesXml);
    if (notes.missingFootnoteRefs.length > 0) {
      issues.push(`Missing footnote refs: ${notes.missingFootnoteRefs.join(', ')}`);
    }
    if (notes.missingEndnoteRefs.length > 0) {
      issues.push(`Missing endnote refs: ${notes.missingEndnoteRefs.join(', ')}`);
    }
    if (notes.duplicateFootnoteIds.length > 0) {
      issues.push(`Duplicate footnote IDs: ${notes.duplicateFootnoteIds.join(', ')}`);
    }
    if (notes.duplicateEndnoteIds.length > 0) {
      issues.push(`Duplicate endnote IDs: ${notes.duplicateEndnoteIds.join(', ')}`);
    }

    const bookmarks = validateBookmarkIntegrity(documentXml);
    if (bookmarks.unmatchedStartIds.length > 0) {
      issues.push(`Unmatched bookmark starts: ${bookmarks.unmatchedStartIds.length}`);
    }
    if (bookmarks.unmatchedEndIds.length > 0) {
      issues.push(`Unmatched bookmark ends: ${bookmarks.unmatchedEndIds.length}`);
    }
    if (bookmarks.duplicateStartIds.length > 0) {
      issues.push(`Duplicate bookmark start IDs: ${bookmarks.duplicateStartIds.length}`);
    }
    if (bookmarks.duplicateEndIds.length > 0) {
      issues.push(`Duplicate bookmark end IDs: ${bookmarks.duplicateEndIds.length}`);
    }

    const passed = issues.length === 0;
    const detail = passed
      ? 'All structural validators passed'
      : issues.join('; ');

    return { passed, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { passed: false, detail: `G3 error: ${msg}` };
  }
}

// ── Gate orchestrator ───────────────────────────────────────────────

export async function runGates(
  resultBuffer: Buffer,
  resultDocumentXml: string,
  originalText: string,
  revisedText: string,
  originalBuffer: Buffer,
  revisedBuffer: Buffer,
): Promise<{ gates: GateResults; hardGatesPassed: boolean; softGatesPassed: boolean }> {
  const textRoundTrip = gateTextRoundTrip(resultDocumentXml, originalText, revisedText);

  const g1Passed =
    textRoundTrip.xmlParseValidity.passed &&
    textRoundTrip.normalizedTextParity.passed &&
    textRoundTrip.paragraphCountParity.passed;

  const structuralIntegrity = await gateStructuralIntegrity(resultBuffer);
  const formattingProjection = await gateFormattingProjection(resultBuffer, revisedBuffer, originalBuffer);

  const hardGatesPassed = g1Passed && structuralIntegrity.passed;
  const softGatesPassed = formattingProjection.passed;

  return {
    gates: {
      textRoundTrip,
      formattingProjection,
      structuralIntegrity,
    },
    hardGatesPassed,
    softGatesPassed,
  };
}
