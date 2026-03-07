import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { parseXml } from './xml.js';
import {
  computeListLabelForParagraph,
  parseNumberingXml,
  type NumberingCounters,
} from './numbering.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeNumberingDoc(innerXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="${W_NS}">${innerXml}</w:numbering>`
  );
}

describe('numbering primitives', () => {
  it('returns empty model when numbering part is missing', () => {
    const model = parseNumberingXml(null);
    expect(model.abstractNums.size).toBe(0);
    expect(model.nums.size).toBe(0);
  });

  it('parses abstractNum/num definitions and skips invalid levels', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="10">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `<w:lvl w:ilvl="x"><w:start w:val="1"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="4">` +
      `<w:abstractNumId w:val="10"/>` +
      `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride>` +
      `</w:num>`
    );

    const model = parseNumberingXml(doc);
    expect(model.abstractNums.get('10')?.levels.has(0)).toBe(true);
    expect(model.abstractNums.get('10')?.levels.has(1)).toBe(false);
    expect(model.nums.get('4')?.startOverrideByLevel.get(0)).toBe(3);
  });

  it('computes labels with start overrides and deeper-level resets', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="20">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="9">` +
      `<w:abstractNumId w:val="20"/>` +
      `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride>` +
      `<w:lvlOverride w:ilvl="1"><w:startOverride w:val="2"/></w:lvlOverride>` +
      `</w:num>`
    );
    const model = parseNumberingXml(doc);
    const counters: NumberingCounters = new Map();

    expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 0 })).toBe('3.');
    expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('3.b)');
    expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('3.c)');

    // Back to level 0 should reset deeper counters to startOverride-1.
    expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 0 })).toBe('4.');
    expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('4.b)');
  });

  it('formats bullet/none/roman and unknown formats through lvlText placeholders', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="30">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="%1"/></w:lvl>` +
      `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="none"/><w:lvlText w:val="(%2)"/></w:lvl>` +
      `<w:lvl w:ilvl="2"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%3."/></w:lvl>` +
      `<w:lvl w:ilvl="3"><w:start w:val="7"/><w:numFmt w:val="unknownFmt"/><w:lvlText w:val="%4."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="11"><w:abstractNumId w:val="30"/></w:num>`
    );
    const model = parseNumberingXml(doc);
    const counters: NumberingCounters = new Map();

    expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 0 })).toBe('•');
    expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 1 })).toBe('()');
    expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 2 })).toBe('IV.');
    // Unknown format falls back to decimal.
    expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 3 })).toBe('7.');
  });

  it('returns empty label when level definition is missing', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="40">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="12"><w:abstractNumId w:val="40"/></w:num>`
    );
    const model = parseNumberingXml(doc);
    const counters: NumberingCounters = new Map();
    expect(computeListLabelForParagraph(model, counters, { numId: '12', ilvl: 5 })).toBe('');
  });

  it('returns empty label when numId is missing from numbering model', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="50">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="15"><w:abstractNumId w:val="50"/></w:num>`
    );
    const model = parseNumberingXml(doc);
    const counters: NumberingCounters = new Map();

    expect(computeListLabelForParagraph(model, counters, { numId: 'missing', ilvl: 0 })).toBe('');
    expect(counters.size).toBe(0);
  });

  it('drops invalid placeholder indices and falls back to decimal for missing level definitions', () => {
    const doc = makeNumberingDoc(
      `<w:abstractNum w:abstractNumId="51">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%0.%1.%10."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="16"><w:abstractNumId w:val="51"/></w:num>`
    );
    const model = parseNumberingXml(doc);
    const counters: NumberingCounters = new Map();

    expect(computeListLabelForParagraph(model, counters, { numId: '16', ilvl: 0 })).toBe('.1.0.');
  });
});
