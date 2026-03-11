import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import {
  computeListLabelForParagraph,
  parseNumberingXml,
  type NumberingCounters,
} from '../src/primitives/numbering.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Numbering' });

function makeNumberingDoc(innerXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="${W_NS}">${innerXml}</w:numbering>`
  );
}

describe('numbering primitives', () => {
  test('returns empty model when numbering part is missing', async ({ given, when, then }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;

    await given('no numbering part (null input)', async () => {});

    await when('parseNumberingXml is called with null', async () => {
      model = parseNumberingXml(null);
    });

    await then('abstractNums and nums maps are empty', () => {
      expect(model.abstractNums.size).toBe(0);
      expect(model.nums.size).toBe(0);
    });
  });

  test('parses abstractNum/num definitions and skips invalid levels', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let model!: ReturnType<typeof parseNumberingXml>;

    await given('a numbering document with one valid level and one invalid level (ilvl=x)', async () => {
      doc = makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="10">` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
        `<w:lvl w:ilvl="x"><w:start w:val="1"/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="4">` +
        `<w:abstractNumId w:val="10"/>` +
        `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride>` +
        `</w:num>`
      );
    });

    await when('parseNumberingXml is called', async () => {
      model = parseNumberingXml(doc);
    });

    await then('level 0 is parsed and level with invalid ilvl is skipped', () => {
      expect(model.abstractNums.get('10')?.levels.has(0)).toBe(true);
      expect(model.abstractNums.get('10')?.levels.has(1)).toBe(false);
    });

    await and('the startOverride for numId 4 level 0 is 3', () => {
      expect(model.nums.get('4')?.startOverrideByLevel.get(0)).toBe(3);
    });
  });

  test('computes labels with start overrides and deeper-level resets', async ({ given, when, then, and }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let counters!: NumberingCounters;

    await given('a numbering document with two levels and start overrides (level 0 starts at 3, level 1 at 2)', async () => {
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
      model = parseNumberingXml(doc);
      counters = new Map();
    });

    await when('computeListLabelForParagraph is called for a sequence of paragraphs', async () => {});

    await then('level 0 starts at 3 and level 1 starts at its override value', () => {
      expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 0 })).toBe('3.');
      expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('3.b)');
      expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('3.c)');
    });

    await and('returning to level 0 increments it and resets deeper counters to startOverride-1', () => {
      // Back to level 0 should reset deeper counters to startOverride-1.
      expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 0 })).toBe('4.');
      expect(computeListLabelForParagraph(model, counters, { numId: '9', ilvl: 1 })).toBe('4.b)');
    });
  });

  test('formats bullet/none/roman and unknown formats through lvlText placeholders', async ({ given, when, then, and }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let counters!: NumberingCounters;

    await given('a numbering document with bullet, none, upperRoman, and unknown format levels', async () => {
      const doc = makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="30">` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="%1"/></w:lvl>` +
        `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="none"/><w:lvlText w:val="(%2)"/></w:lvl>` +
        `<w:lvl w:ilvl="2"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%3."/></w:lvl>` +
        `<w:lvl w:ilvl="3"><w:start w:val="7"/><w:numFmt w:val="unknownFmt"/><w:lvlText w:val="%4."/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="11"><w:abstractNumId w:val="30"/></w:num>`
      );
      model = parseNumberingXml(doc);
      counters = new Map();
    });

    await when('computeListLabelForParagraph is called for each level', async () => {});

    await then('bullet renders as bullet char, none renders empty placeholder, and roman starts at IV', () => {
      expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 0 })).toBe('•');
      expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 1 })).toBe('()');
      expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 2 })).toBe('IV.');
    });

    await and('unknown format falls back to decimal', () => {
      // Unknown format falls back to decimal.
      expect(computeListLabelForParagraph(model, counters, { numId: '11', ilvl: 3 })).toBe('7.');
    });
  });

  test('returns empty label when level definition is missing', async ({ given, when, then }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let counters!: NumberingCounters;

    await given('a numbering document with only level 0 defined', async () => {
      const doc = makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="40">` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="12"><w:abstractNumId w:val="40"/></w:num>`
      );
      model = parseNumberingXml(doc);
      counters = new Map();
    });

    await when('computeListLabelForParagraph is called for level 5 which does not exist', async () => {});

    await then('an empty string is returned', () => {
      expect(computeListLabelForParagraph(model, counters, { numId: '12', ilvl: 5 })).toBe('');
    });
  });

  test('returns empty label when numId is missing from numbering model', async ({ given, when, then, and }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let counters!: NumberingCounters;

    await given('a numbering document with numId 15 defined', async () => {
      const doc = makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="50">` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="15"><w:abstractNumId w:val="50"/></w:num>`
      );
      model = parseNumberingXml(doc);
      counters = new Map();
    });

    await when('computeListLabelForParagraph is called with a missing numId', async () => {});

    await then('an empty string is returned', () => {
      expect(computeListLabelForParagraph(model, counters, { numId: 'missing', ilvl: 0 })).toBe('');
    });

    await and('counters remain empty (no side effects)', () => {
      expect(counters.size).toBe(0);
    });
  });

  test('drops invalid placeholder indices and falls back to decimal for missing level definitions', async ({ given, when, then }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let counters!: NumberingCounters;

    await given('a numbering document with lvlText containing %0, %1, and %10 placeholders', async () => {
      const doc = makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="51">` +
        `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%0.%1.%10."/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="16"><w:abstractNumId w:val="51"/></w:num>`
      );
      model = parseNumberingXml(doc);
      counters = new Map();
    });

    await when('computeListLabelForParagraph is called for level 0', async () => {});

    await then('invalid placeholder %0 is dropped, %1 resolves, and %10 falls back to decimal 0', () => {
      expect(computeListLabelForParagraph(model, counters, { numId: '16', ilvl: 0 })).toBe('.1.0.');
    });
  });
});
