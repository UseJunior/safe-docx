import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml } from '../src/primitives/xml.js';
import {
  advanceListLabel,
  computeListLabelForParagraph,
  parseNumberingXml,
  renderListLevelText,
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

  /**
   * Two `w:num` instances over one `w:abstractNum` share one running list.
   * Expected labels are what Word for Mac 16.114 showed for the same
   * numbering part and paragraph sequences (list string per paragraph via
   * AppleScript); the raw evidence is in
   * scripts/oracle/word/evidence/issue-1243-word-16.114.json.
   */
  const sharedListTest = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.26' });
  const lvl = (ilvl: number, fmt: string, text: string, extra = '') =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/></w:lvl>`;
  const override = (numId: number, abs: number, ilvl: number, start: number) =>
    `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abs}"/>` +
    `<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`;
  const plain = (numId: number, abs: number) => `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abs}"/></w:num>`;
  const sharedModel = () =>
    parseNumberingXml(
      makeNumberingDoc(
        `<w:abstractNum w:abstractNumId="0">${lvl(0, 'decimal', '%1.')}${lvl(1, 'lowerLetter', '%1(%2)')}${lvl(2, 'lowerRoman', '%1(%2)(%3)')}</w:abstractNum>` +
          `<w:abstractNum w:abstractNumId="1">${lvl(0, 'decimal', '%1.')}${lvl(1, 'decimal', '%1.%2', '<w:lvlRestart w:val="0"/>')}</w:abstractNum>` +
          plain(1, 0) + plain(2, 0) + override(3, 0, 0, 5) + override(4, 0, 1, 5) + override(6, 0, 0, 1) +
          plain(7, 1) + plain(8, 1) + override(12, 0, 0, 5) + override(21, 1, 1, 5),
      ),
    );
  // [numId, ilvl] per paragraph, and the label Word showed for each.
  const WORD_ORACLE: Array<{ name: string; seq: Array<[number, number]>; word: string[] }> = [
    { name: 'a second instance without an override continues the list', seq: [[1, 0], [1, 0], [2, 0], [1, 0], [2, 0]], word: ['1.', '2.', '3.', '4.', '5.'] },
    {
      name: 'an override restarts the shared list only at its instance\'s first paragraph',
      seq: [[1, 0], [1, 0], [1, 0], [3, 0], [3, 0], [1, 0], [3, 0]],
      word: ['1.', '2.', '3.', '5.', '6.', '7.', '8.'],
    },
    { name: 'an override instance used first, then the plain instances continue it', seq: [[3, 0], [3, 0], [1, 0], [1, 0], [3, 0], [2, 0]], word: ['5.', '6.', '7.', '8.', '9.', '10.'] },
    { name: 'interleaved override and plain instances', seq: [[1, 0], [3, 0], [1, 0], [3, 0], [1, 0]], word: ['1.', '5.', '6.', '7.', '8.'] },
    { name: 'a startOverride of 1 is Word\'s "Restart numbering"', seq: [[1, 0], [1, 0], [1, 0], [6, 0], [6, 0], [1, 0], [6, 0]], word: ['1.', '2.', '3.', '1.', '2.', '3.', '4.'] },
    { name: 'each override instance restarts once', seq: [[3, 0], [3, 0], [12, 0], [12, 0], [3, 0], [1, 0]], word: ['5.', '6.', '5.', '6.', '7.', '8.'] },
    {
      name: 'an override restart may move the count backwards',
      seq: [[1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [3, 0], [1, 0]],
      word: ['1.', '2.', '3.', '4.', '5.', '6.', '5.', '6.'],
    },
    {
      name: 'deeper levels are shared too',
      seq: [[1, 0], [1, 1], [1, 1], [2, 1], [2, 0], [2, 1], [1, 1]],
      word: ['1.', '1(a)', '1(b)', '1(c)', '2.', '2(a)', '2(b)'],
    },
    {
      name: 'a level-1 override applies at the instance\'s first level-1 paragraph',
      seq: [[1, 0], [1, 1], [1, 1], [4, 1], [4, 1], [1, 1], [1, 0], [4, 1], [4, 0]],
      word: ['1.', '1(a)', '1(b)', '1(e)', '1(f)', '1(g)', '2.', '2(a)', '3.'],
    },
    {
      name: 'a level-0 override waits for its instance\'s first level-0 paragraph',
      seq: [[1, 0], [1, 1], [1, 1], [3, 1], [3, 0], [3, 1], [1, 1]],
      word: ['1.', '1(a)', '1(b)', '1(c)', '5.', '5(a)', '5(b)'],
    },
    {
      name: 'a restart caused by an override instance uses that instance\'s start',
      seq: [[1, 0], [1, 1], [4, 0], [4, 1], [4, 1], [1, 1]],
      word: ['1.', '1(a)', '2.', '2(e)', '2(f)', '2(g)'],
    },
    {
      name: 'an override instance used only on level 0 still restarts level 1 at its override',
      seq: [[1, 0], [4, 0], [1, 1], [4, 1], [1, 1]],
      word: ['1.', '2.', '2(e)', '2(e)', '2(f)'],
    },
    {
      name: 'a restart caused by an override instance after its first level-1 paragraph still uses its override',
      seq: [[1, 0], [1, 1], [4, 1], [4, 0], [4, 1], [1, 0], [1, 1]],
      word: ['1.', '1(a)', '1(e)', '2.', '2(e)', '3.', '3(a)'],
    },
    {
      name: 'an instance first used below its overridden level does not restart that level',
      seq: [[1, 0], [1, 1], [4, 2], [1, 1], [4, 1]],
      word: ['1.', '1(a)', '1(a)(i)', '1(b)', '1(e)'],
    },
    {
      name: 'lvlRestart 0 keeps a level counting through an override instance until its first paragraph on that level',
      seq: [[7, 0], [7, 1], [21, 0], [7, 1], [21, 1], [7, 1]],
      word: ['1.', '1.1', '2.', '2.2', '2.5', '2.6'],
    },
    { name: 'lvlRestart 0 levels continue across instances', seq: [[7, 0], [7, 1], [8, 0], [8, 1], [7, 0], [7, 1]], word: ['1.', '1.1', '2.', '2.2', '3.', '3.3'] },
  ];

  for (const { name, seq, word } of WORD_ORACLE) {
    sharedListTest(`shared abstractNum list (Word oracle): ${name}`, async ({ given, when, then }: AllureBddContext) => {
      let model!: ReturnType<typeof parseNumberingXml>;
      let labels!: string[];
      await given(`w:num instances over one w:abstractNum and the paragraph sequence ${JSON.stringify(seq)}`, async () => {
        model = sharedModel();
      });
      await when('labels are computed in document order with one counters map', async () => {
        const counters: NumberingCounters = new Map();
        labels = seq.map(([numId, ilvl]) => computeListLabelForParagraph(model, counters, { numId: String(numId), ilvl }));
      });
      await then(`the labels match Word: ${word.join(' ')}`, () => {
        expect(labels).toEqual(word);
      });
    });
  }

  test('a label snapshot carries every ancestor level value for full-context rendering', async ({ given, when, then, and }: AllureBddContext) => {
    let model!: ReturnType<typeof parseNumberingXml>;
    let snapshot!: ReturnType<typeof advanceListLabel>;
    await given('an ARTICLE / Section / (a) outline with a second instance', async () => {
      model = parseNumberingXml(
        makeNumberingDoc(
          `<w:abstractNum w:abstractNumId="0">${lvl(0, 'upperRoman', 'ARTICLE %1')}${lvl(1, 'decimalZero', 'Section %1.%2', '<w:isLgl/>')}${lvl(2, 'lowerLetter', '(%3)')}</w:abstractNum>` +
            plain(1, 0) + plain(2, 0),
        ),
      );
    });
    await when('ARTICLE I, II, Section 2.01, 2.02, (a), (b) are numbered, the clause through the second instance', async () => {
      const counters: NumberingCounters = new Map();
      for (const ilvl of [0, 0, 1, 1, 2]) advanceListLabel(model, counters, { numId: '1', ilvl });
      snapshot = advanceListLabel(model, counters, { numId: '2', ilvl: 2 });
    });
    await then('the snapshot names the shared abstract list and its level values', () => {
      expect(snapshot).toEqual({ numId: '2', abstractNumId: '0', ilvl: 2, label: '(b)', levelValues: [2, 2, 2] });
    });
    await and('each ancestor level renders from the snapshot without advancing counters', () => {
      expect(renderListLevelText(model, '2', 0, snapshot!.levelValues)).toBe('ARTICLE II');
      expect(renderListLevelText(model, '2', 1, snapshot!.levelValues)).toBe('Section 2.02');
      expect(renderListLevelText(model, '2', 5, snapshot!.levelValues)).toBe('');
    });
    await and('an undefined instance yields no snapshot', () => {
      expect(advanceListLabel(model, new Map(), { numId: '99', ilvl: 0 })).toBeNull();
    });
  });
});
