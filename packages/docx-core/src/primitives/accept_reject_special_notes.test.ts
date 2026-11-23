import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { DocxDocument } from './document.js';
import { DocxZip } from './zip.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';

// #1489: package-level accept/reject pruned the continuationNotice footnote as
// an orphan, leaving settings.xml w:footnotePr referencing a missing note.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Special note survival across accept and reject' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.9' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.10' },
  );

const DATE = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
const special = (kind: 'footnote' | 'endnote') =>
  `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
  `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>` +
  `<w:${kind} w:type="continuationNotice" w:id="1"><w:p><w:r><w:t>continued</w:t></w:r></w:p></w:${kind}>`;
const notesPart = (kind: 'footnote' | 'endnote', extra = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s xmlns:w="${W}">${special(kind)}${extra}</w:${kind}s>`;
const settingsXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}">` +
  '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/><w:footnote w:id="1"/></w:footnotePr>' +
  '<w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/><w:endnote w:id="1"/></w:endnotePr>' +
  '</w:settings>';

async function buildPackage(bodyXml: string): Promise<Buffer> {
  const zip = await DocxZip.load(await buildDocxFromBodyXml(bodyXml));
  zip.writeText('word/footnotes.xml', notesPart('footnote', '<w:footnote w:id="2"><w:p><w:r><w:t>real note</w:t></w:r></w:p></w:footnote>'));
  zip.writeText('word/endnotes.xml', notesPart('endnote'));
  zip.writeText('word/settings.xml', settingsXml);
  const rels = (await zip.readText('word/_rels/document.xml.rels')).replace('</Relationships>',
    `<Relationship Id="rIdFn" Type="${REL}/footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rIdEn" Type="${REL}/endnotes" Target="endnotes.xml"/>` +
    `<Relationship Id="rIdSt" Type="${REL}/settings" Target="settings.xml"/></Relationships>`);
  zip.writeText('word/_rels/document.xml.rels', rels);
  return zip.toBuffer();
}

async function noteIds(buf: Uint8Array, kind: 'footnote' | 'endnote'): Promise<string[]> {
  const zip = await DocxZip.load(Buffer.from(buf));
  const doc = parseXml(await zip.readText(`word/${kind}s.xml`));
  return Array.from(doc.getElementsByTagNameNS(W, kind)).map(n => n.getAttributeNS(W, 'id') ?? '');
}

async function settingsRefsResolve(buf: Uint8Array): Promise<void> {
  const zip = await DocxZip.load(Buffer.from(buf));
  const settings = parseXml(await zip.readText('word/settings.xml'));
  for (const kind of ['footnote', 'endnote'] as const) {
    const live = new Set(await noteIds(buf, kind));
    const pr = settings.getElementsByTagNameNS(W, `${kind}Pr`).item(0)!;
    for (const ref of Array.from(pr.getElementsByTagNameNS(W, kind))) {
      expect(live.has(ref.getAttributeNS(W, 'id') ?? '')).toBe(true);
    }
  }
}

// Body: a deleted footnote reference (accept orphans note 2) and an inserted
// one (reject orphans note 2), so the orphan-prune sweep runs in both modes.
const BODY =
  `<w:p><w:r><w:t>Text</w:t></w:r><w:del w:id="10" ${DATE}><w:r><w:footnoteReference w:id="2"/></w:r></w:del></w:p>` +
  `<w:p><w:r><w:t>More</w:t></w:r><w:ins w:id="11" ${DATE}><w:r><w:footnoteReference w:id="2"/></w:r></w:ins></w:p>`;

describe('accept/reject keep settings-referenced special notes (#1489)', () => {
  test('acceptChanges keeps separator, continuationSeparator and continuationNotice notes', async () => {
    const doc = await DocxDocument.load(await buildPackage(BODY));
    await doc.acceptChanges();
    const out = (await doc.toBuffer({ cleanBookmarks: false })).buffer;
    expect(await noteIds(out, 'footnote')).toEqual(['-1', '0', '1', '2']);
    expect(await noteIds(out, 'endnote')).toEqual(['-1', '0', '1']);
    await settingsRefsResolve(out);
  });

  test('rejectChanges keeps separator, continuationSeparator and continuationNotice notes', async () => {
    const doc = await DocxDocument.load(await buildPackage(BODY));
    await doc.rejectChanges();
    const out = (await doc.toBuffer({ cleanBookmarks: false })).buffer;
    expect(await noteIds(out, 'footnote')).toEqual(['-1', '0', '1', '2']);
    expect(await noteIds(out, 'endnote')).toEqual(['-1', '0', '1']);
    await settingsRefsResolve(out);
  });

  test('an orphaned ordinary note is still pruned', async () => {
    const doc = await DocxDocument.load(await buildPackage(
      `<w:p><w:r><w:t>Text</w:t></w:r><w:del w:id="10" ${DATE}><w:r><w:footnoteReference w:id="2"/></w:r></w:del></w:p>`));
    await doc.acceptChanges();
    const out = (await doc.toBuffer({ cleanBookmarks: false })).buffer;
    expect(await noteIds(out, 'footnote')).toEqual(['-1', '0', '1']);
    await settingsRefsResolve(out);
  });
});
