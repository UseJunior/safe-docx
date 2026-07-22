import { describe, it, expect } from 'vitest';
import { buildDocxFromParts, parseXml } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { ODF_NS } from '../shared/odf/namespaces.js';

function listP(numId: number, ilvl: number, text: string): string {
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  );
}

function numberingXml(levels: Array<{ ilvl: number; numFmt: string; lvlText: string }>): string {
  const lvls = levels
    .map(
      (l) =>
        `<w:lvl w:ilvl="${l.ilvl}"><w:start w:val="1"/><w:numFmt w:val="${l.numFmt}"/>` +
        `<w:lvlText w:val="${l.lvlText}"/><w:suff w:val="space"/></w:lvl>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:abstractNum w:abstractNumId="0">${lvls}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    `</w:numbering>`
  );
}

async function contentDom(odt: Buffer): Promise<Document> {
  return parseXml(await (await OdfArchive.load(odt)).getContentXml());
}

describe('convertDocxToOdt — lists', () => {
  it('[CONV-06] auto-numbered lists nest text:list with mapped number formats; level jumps stay well-formed', async () => {
    const docx = await buildDocxFromParts({
      bodyXml:
        listP(1, 0, 'one') +
        listP(1, 1, 'one-a') +
        listP(1, 0, 'two') +
        listP(1, 2, 'jump two levels') +
        listP(1, 2, 'jump sibling'),
      numberingXml: numberingXml([
        { ilvl: 0, numFmt: 'decimal', lvlText: '%1.' },
        { ilvl: 1, numFmt: 'lowerLetter', lvlText: '%2)' },
        { ilvl: 2, numFmt: 'upperRoman', lvlText: '%3.' },
      ]),
    });
    const { odt } = await convertDocxToOdt(docx);
    const doc = await contentDom(odt);

    // List style: per-level num formats mapped from OOXML numFmt.
    const listStyles = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'list-style'));
    expect(listStyles).toHaveLength(1);
    const numLevels = Array.from(listStyles[0]!.getElementsByTagNameNS(ODF_NS.TEXT, 'list-level-style-number'));
    const fmtByLevel = new Map(
      numLevels.map((el) => [el.getAttributeNS(ODF_NS.TEXT, 'level'), el.getAttributeNS(ODF_NS.STYLE, 'num-format')]),
    );
    expect(fmtByLevel.get('1')).toBe('1');
    expect(fmtByLevel.get('2')).toBe('a');
    expect(fmtByLevel.get('3')).toBe('I');
    const suffixByLevel = new Map(
      numLevels.map((el) => [el.getAttributeNS(ODF_NS.TEXT, 'level'), el.getAttributeNS(ODF_NS.STYLE, 'num-suffix')]),
    );
    expect(suffixByLevel.get('1')).toBe('.');
    expect(suffixByLevel.get('2')).toBe(')');

    // Nesting depth of each item's text:p — count enclosing text:list ancestors.
    const depthOf = (text: string): number => {
      const para = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')).find((el) => el.textContent === text);
      expect(para, `paragraph "${text}"`).toBeDefined();
      let depth = 0;
      for (let n = para!.parentNode; n; n = n.parentNode) {
        if ((n as Element).localName === 'list' && (n as Element).namespaceURI === ODF_NS.TEXT) depth += 1;
      }
      return depth;
    };
    expect(depthOf('one')).toBe(1);
    expect(depthOf('one-a')).toBe(2);
    expect(depthOf('two')).toBe(1);
    // A jump of two ilvls opens a single nested step (not three), and the jumped level's
    // sibling lands at the same depth instead of nesting further.
    expect(depthOf('jump two levels')).toBe(2);
    expect(depthOf('jump sibling')).toBe(2);
  });

  it('[CONV-07] bullet lists become text:list with a bullet list style', async () => {
    const docx = await buildDocxFromParts({
      bodyXml: listP(1, 0, 'first bullet') + listP(1, 0, 'second bullet'),
      numberingXml: numberingXml([{ ilvl: 0, numFmt: 'bullet', lvlText: '' }]),
    });
    const { odt } = await convertDocxToOdt(docx);
    const doc = await contentDom(odt);

    const lists = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'list'));
    expect(lists).toHaveLength(1);
    const items = Array.from(lists[0]!.getElementsByTagNameNS(ODF_NS.TEXT, 'list-item'));
    expect(items).toHaveLength(2);
    const bulletLevels = doc.getElementsByTagNameNS(ODF_NS.TEXT, 'list-level-style-bullet');
    expect(bulletLevels.length).toBeGreaterThan(0);
    expect(bulletLevels[0]!.getAttributeNS(ODF_NS.TEXT, 'bullet-char')).toBe('•');
  });

  it('[CONV-08] manual/legal labels stay literal paragraph text with no text:list wrapper', async () => {
    const docx = await buildDocxFromParts({
      bodyXml:
        `<w:p><w:r><w:t xml:space="preserve">Section 2.1 Confidential Information.</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t xml:space="preserve">(a) each party shall comply.</w:t></w:r></w:p>`,
    });
    const { odt } = await convertDocxToOdt(docx);
    const doc = await contentDom(odt);

    expect(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'list')).toHaveLength(0);
    const texts = Array.from(doc.getElementsByTagNameNS(ODF_NS.TEXT, 'p')).map((el) => el.textContent);
    expect(texts).toContain('Section 2.1 Confidential Information.');
    expect(texts).toContain('(a) each party shall comply.');
  });
});
