/**
 * Issue #94 Regression — rebuild output must be structurally complete.
 *
 * https://github.com/UseJunior/safe-docx/issues/94 reported corrupt DOCX
 * output that Word refused to open after compare_documents. The reporter
 * diagnosed it as unbalanced <w:ins>/<w:del> tags (24 opens / 13 closes),
 * but that count was almost certainly a regex artifact on DOM-serialized
 * XML — the actual corruption mode was structural: rebuild output
 * referenced auxiliary definitions (footnotes, comments) that did not
 * exist in the result archive, and OPC metadata ([Content_Types].xml,
 * document.xml.rels) was inconsistent with the parts present.
 *
 * This file pins the structural invariants that, when held, mean Word
 * can open the file:
 *
 *   1. document.xml is well-formed XML (catches any unbalanced revision
 *      wrappers — an XML parser cannot accept unbalanced tags).
 *   2. Every reference (w:footnoteReference, w:endnoteReference,
 *      w:commentReference) resolves to a matching definition.
 *   3. Every relationship target in document.xml.rels exists as an
 *      archive part.
 *   4. Every archive part has a registered Content Type.
 *
 * Scenarios deliberately exercise rebuild mode because that is the path
 * the original PR gated incorrectly.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { parseXml } from '../primitives/xml.js';
import { buildSyntheticDocx } from './synthetic-docx-fixture.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Issue #94 Structural Invariants' });

interface CompletenessReport {
  documentXmlWellFormed: boolean;
  unresolvedReferences: { tag: string; id: string; expectedIn: string }[];
  missingRelTargets: string[];
  partsWithoutContentType: string[];
}

async function assertStructurallyComplete(buffer: Buffer): Promise<CompletenessReport> {
  const archive = await DocxArchive.load(buffer);
  const documentXml = await archive.getDocumentXml();

  // 1. document.xml must parse as well-formed XML. parseXml throws on
  // <parsererror> output from xmldom (which is what unbalanced or malformed
  // tags surface as).
  let doc: Document | null = null;
  let documentXmlWellFormed = true;
  try {
    doc = parseXml(documentXml);
  } catch {
    documentXmlWellFormed = false;
  }

  const unresolvedReferences: { tag: string; id: string; expectedIn: string }[] = [];
  const refSpecs: { tag: string; partPath: string; entryTag: string }[] = [
    { tag: 'w:footnoteReference', partPath: 'word/footnotes.xml', entryTag: 'w:footnote' },
    { tag: 'w:endnoteReference', partPath: 'word/endnotes.xml', entryTag: 'w:endnote' },
    { tag: 'w:commentReference', partPath: 'word/comments.xml', entryTag: 'w:comment' },
  ];

  if (doc) {
    for (const spec of refSpecs) {
      const refs = doc.getElementsByTagName(spec.tag);
      if (refs.length === 0) continue;
      const partXml = await archive.getFile(spec.partPath);
      const definedIds = new Set<string>();
      if (partXml) {
        const partDoc = parseXml(partXml);
        const entries = partDoc.getElementsByTagName(spec.entryTag);
        for (let i = 0; i < entries.length; i++) {
          const id = (entries[i] as Element).getAttribute('w:id');
          if (id) definedIds.add(id);
        }
      }
      for (let i = 0; i < refs.length; i++) {
        const id = (refs[i] as Element).getAttribute('w:id');
        if (!id) continue;
        if (!definedIds.has(id)) {
          unresolvedReferences.push({ tag: spec.tag, id, expectedIn: spec.partPath });
        }
      }
    }
  }

  // 3. Every relationship target in document.xml.rels must exist in the archive.
  const missingRelTargets: string[] = [];
  const relsXml = await archive.getFile('word/_rels/document.xml.rels');
  if (relsXml) {
    const relsDoc = parseXml(relsXml);
    const rels = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i] as Element;
      const target = rel.getAttribute('Target');
      const targetMode = rel.getAttribute('TargetMode');
      if (!target || targetMode === 'External') continue;
      // Targets in document.xml.rels are relative to word/
      const resolved = target.startsWith('/') ? target.slice(1) : `word/${target}`;
      const exists = (await archive.getFile(resolved)) !== null;
      if (!exists) missingRelTargets.push(resolved);
    }
  }

  // 4. Every archive part should have a Content Type (Override or Default-by-extension).
  const partsWithoutContentType: string[] = [];
  const ctXml = await archive.getFile('[Content_Types].xml');
  if (ctXml) {
    const ctDoc = parseXml(ctXml);
    const overrides = new Set<string>();
    const defaultExtensions = new Set<string>();
    const ovEls = ctDoc.getElementsByTagName('Override');
    for (let i = 0; i < ovEls.length; i++) {
      const pn = (ovEls[i] as Element).getAttribute('PartName');
      if (pn) overrides.add(pn);
    }
    const defEls = ctDoc.getElementsByTagName('Default');
    for (let i = 0; i < defEls.length; i++) {
      const ext = (defEls[i] as Element).getAttribute('Extension');
      if (ext) defaultExtensions.add(ext.toLowerCase());
    }
    const allPaths = archive.listFiles();
    for (const p of allPaths) {
      if (p === '[Content_Types].xml') continue;
      // Skip directory entries (JSZip returns these from listFiles())
      if (p.endsWith('/')) continue;
      if (p.startsWith('_rels/') || p.includes('/_rels/')) continue;
      const partName = `/${p}`;
      if (overrides.has(partName)) continue;
      const ext = p.split('.').pop()?.toLowerCase();
      if (ext && defaultExtensions.has(ext)) continue;
      partsWithoutContentType.push(p);
    }
  }

  return {
    documentXmlWellFormed,
    unresolvedReferences,
    missingRelTargets,
    partsWithoutContentType,
  };
}

describe('Issue #94 — rebuild output structural completeness', () => {
  describe('Footnote added on revised side, rebuild mode', () => {
    test('rebuild output is structurally complete (well-formed, all refs resolve, OPC consistent)', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no footnotes; revised adds one', async () => {
        original = await buildSyntheticDocx({ paragraphs: ['P1', 'P2'] });
        revised = await buildSyntheticDocx({
          paragraphs: ['P1', 'P2'],
          footnoteOnParagraph: 0,
          footnoteText: 'A new footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('comparing in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('all structural invariants hold', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const report = await assertStructurallyComplete(result.document);
        expect(report.documentXmlWellFormed).toBe(true);
        expect(report.unresolvedReferences).toEqual([]);
        expect(report.missingRelTargets).toEqual([]);
        expect(report.partsWithoutContentType).toEqual([]);
      });
    });
  });

  describe('Comment added on revised side, rebuild mode', () => {
    test('rebuild output is structurally complete', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no comments; revised adds one with ancillary parts', async () => {
        original = await buildSyntheticDocx({ paragraphs: ['P1', 'P2', 'P3'] });
        revised = await buildSyntheticDocx({
          paragraphs: ['P1', 'P2', 'P3'],
          commentOnParagraph: 1,
          commentText: 'Review needed',
          commentAuthor: 'Reviewer',
          commentAncillaryParts: true,
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('comparing in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('all structural invariants hold', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const report = await assertStructurallyComplete(result.document);
        expect(report.documentXmlWellFormed).toBe(true);
        expect(report.unresolvedReferences).toEqual([]);
        expect(report.missingRelTargets).toEqual([]);
        expect(report.partsWithoutContentType).toEqual([]);
      });
    });
  });

  describe('No-op rebuild (same document on both sides)', () => {
    test('rebuild round-trip preserves structural completeness', async ({ given, when, then }: AllureBddContext) => {
      let doc: Buffer;
      await given('a document with footnote, comment, and ancillary parts', async () => {
        doc = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          footnoteOnParagraph: 0,
          footnoteText: 'Footnote text',
          commentOnParagraph: 1,
          commentText: 'Comment text',
          commentAuthor: 'Alice',
          commentAncillaryParts: true,
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('comparing the document against itself in rebuild mode', async () => {
        result = await compareDocuments(doc, doc, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('all structural invariants hold', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const report = await assertStructurallyComplete(result.document);
        expect(report.documentXmlWellFormed).toBe(true);
        expect(report.unresolvedReferences).toEqual([]);
        expect(report.missingRelTargets).toEqual([]);
        expect(report.partsWithoutContentType).toEqual([]);
      });
    });
  });

  describe('Revision-wrapper balance probe', () => {
    test('rebuild output has balanced w:ins / w:del wrappers (the symptom #94 reported)', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('two documents that differ across many words', async () => {
        const zip1 = new JSZip();
        const zip2 = new JSZip();
        const docXml = (paras: string[]) =>
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`;
        const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `</Types>`;
        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`;
        const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
        const sentences = [
          'The quick brown fox jumps over the lazy dog',
          'A wise old owl lived in an oak tree',
          'Pack my box with five dozen liquor jugs',
          'How vexingly quick daft zebras jump',
        ];
        const sentencesAlt = [
          'The slow brown fox climbs over the lazy cat',
          'A wise young owl rested in a pine tree',
          'Pack my crate with five dozen liquor mugs',
          'How vexingly slow daft zebras run',
        ];
        for (const z of [zip1, zip2]) {
          z.file('[Content_Types].xml', ct);
          z.file('_rels/.rels', rootRels);
          z.file('word/_rels/document.xml.rels', docRels);
        }
        zip1.file('word/document.xml', docXml(sentences));
        zip2.file('word/document.xml', docXml(sentencesAlt));
        original = (await zip1.generateAsync({ type: 'nodebuffer' })) as Buffer;
        revised = (await zip2.generateAsync({ type: 'nodebuffer' })) as Buffer;
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('comparing in rebuild mode (forces revision-wrapper emission)', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('document.xml is well-formed (balanced wrappers required by XML parser)', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const archive = await DocxArchive.load(result.document);
        const documentXml = await archive.getDocumentXml();

        // The XML parser is the strongest balanced-tag check available: any
        // unmatched <w:ins> or <w:del> would prevent the document from
        // parsing (this is exactly the failure mode Word would hit).
        let parseError: string | null = null;
        let parsed: Document | null = null;
        try {
          parsed = parseXml(documentXml);
        } catch (err) {
          parseError = (err as Error).message;
        }
        expect(parseError).toBeNull();
        expect(parsed).not.toBeNull();

        // Smoke check: at least one revision wrapper is emitted. Confirms the
        // rebuild path actually exercised the wrapper-emission code path.
        expect(parsed!.getElementsByTagName('w:ins').length).toBeGreaterThan(0);
        expect(parsed!.getElementsByTagName('w:del').length).toBeGreaterThan(0);
      });
    });
  });
});
