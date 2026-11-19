import { describe, expect } from 'vitest';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

/**
 * Move detection only relocates content the in-order alignment leaves
 * unpaired, and only when both sides resemble each other as spans (#1498).
 * In-place edits of a sequence whose order is unchanged produce no moves.
 * Verbatim text relocated between paired paragraphs is still a move: that
 * exact pass is unchanged and pinned by paragraphMoveReview.test.ts.
 */
const TEST_FEATURE = 'refactor-tracked-paragraph-move-ownership';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Deterministic PRNG so each seed reproduces the same document pair. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBJECTS = ['the Manager', 'the Owner', 'the Partner', 'the Fund', 'the Custodian'];
const VERBS = ['shall deliver', 'shall keep confidential', 'may withdraw', 'shall pay', 'shall not disclose', 'shall cause the Fund to amend'];
const OBJECTS = ['all records relating to the Account', 'the quarterly statements', 'any amount credited under Section 4', 'the Fund Documents', 'the audited financial statements'];
const TAILS = ['within thirty (30) days after the end of each quarter', 'except as required by law or judicial process', 'on the terms of this Agreement', 'subject to Section 7(c)', 'without the prior written consent of the Owner'];
const INSERTED_SENTENCE = 'The Partner is jointly and severally liable with the Manager for that payment. ';

/** The issue's generator: clauses from a small vocabulary, edited in place, never reordered. */
function inPlaceEditPair(seed: number, paragraphCount = 40, editCount = 8): { base: string[]; revised: string[] } {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const sentence = (): string => {
    const subject = pick(SUBJECTS);
    return `${subject[0]!.toUpperCase()}${subject.slice(1)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}.`;
  };
  const base = Array.from({ length: paragraphCount }, (_, index) =>
    `(${String.fromCharCode(97 + index % 26)}) Heading ${index}. `
      + Array.from({ length: 3 + Math.floor(random() * 7) }, sentence).join(' '));
  const revised = [...base];
  const indexes = Array.from({ length: paragraphCount }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap]!, indexes[index]!];
  }
  for (const index of indexes.slice(0, editCount)) {
    const kind = pick(['ins', 'rep', 'phrase'] as const);
    const text = revised[index]!;
    if (kind === 'ins') {
      const cut = text.indexOf('. ', 30) + 2;
      revised[index] = text.slice(0, cut) + INSERTED_SENTENCE + text.slice(cut);
    } else if (kind === 'rep') {
      revised[index] = text.includes('the Manager')
        ? text.replace('the Manager', 'the Partner')
        : text.replace('shall', 'must');
    } else {
      revised[index] = text.replace(' shall keep', ' and the Partner each shall keep')
        .replace('the Owner', 'the Owner or the Partner');
    }
  }
  return { base, revised };
}

async function compareParagraphs(base: string, revised: string, options: Parameters<typeof compareDocuments>[2] = {}) {
  const compared = await compareDocuments(
    await buildDocxFromBodyXml(base),
    await buildDocxFromBodyXml(revised),
    options,
  );
  const xml = await (await DocxArchive.load(compared.document)).getDocumentXml();
  const document = parseXml(xml);
  return {
    xml,
    moveFrom: document.getElementsByTagNameNS(W_NS, 'moveFrom').length,
    moveTo: document.getElementsByTagNameNS(W_NS, 'moveTo').length,
    stats: compared.stats,
  };
}

function texts(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'p'))
    .map((paragraph) => paragraph.textContent ?? '');
}

function paragraphs(items: readonly string[]): string {
  return items.map(paragraphWithText).join('');
}

const LONG_A = 'The Manager shall deliver all records relating to the Account within thirty days after the end of each quarter.';
const LONG_B = 'The Custodian may withdraw any amount credited under Section 4 except as required by law or judicial process.';
const LONG_C = 'The Owner shall keep the audited financial statements confidential without the prior written consent of the Fund.';
const LONG_D = 'Each notice under this Agreement shall be in writing and delivered by hand or by registered mail to the addressee.';

describe('in-place edits are never moves (#1498)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    test(`order-preserving in-place edits produce no moves (seed ${seed})`, async () => {
      const { base, revised } = inPlaceEditPair(seed);
      for (const grouping of [undefined, 'readable-semantic'] as const) {
        const result = await compareParagraphs(
          paragraphs(base),
          paragraphs(revised),
          grouping ? { revisionGrouping: grouping } : {},
        );
        expect(result.moveFrom + result.moveTo, `seed ${seed} ${grouping ?? 'default'}`).toBe(0);
        expect(result.stats.moves).toBe(0);
        expect(texts(acceptAllChanges(result.xml))).toEqual(revised);
        expect(texts(rejectAllChanges(result.xml))).toEqual(base);
      }
    });
  }

  test('an inserted phrase whose words all occur in a deleted paragraph is not its move', async () => {
    // Deleting B and inserting a short clause between C and D keeps the order:
    // the clause shares B's vocabulary but is not B relocated.
    const result = await compareParagraphs(
      paragraphs([LONG_A, LONG_B, LONG_C, LONG_D]),
      paragraphs([LONG_A, LONG_C, 'The Custodian may withdraw any amount credited.', LONG_D]),
    );
    expect(result.moveFrom + result.moveTo).toBe(0);
  });
});

describe('genuine moves are still detected (#1498 positive controls)', () => {
  test('a reordered paragraph is a move', async () => {
    const base = [LONG_A, LONG_B, LONG_C, LONG_D];
    const revised = [LONG_A, LONG_C, LONG_D, LONG_B];
    const result = await compareParagraphs(paragraphs(base), paragraphs(revised));
    expect(result.moveFrom).toBeGreaterThan(0);
    expect(result.moveTo).toBeGreaterThan(0);
    expect(texts(acceptAllChanges(result.xml))).toEqual(revised);
    expect(texts(rejectAllChanges(result.xml))).toEqual(base);
  });

  test('a moved paragraph with a small edit is a move', async () => {
    const edited = LONG_B.replace('any amount', 'any unpaid amount');
    const base = [LONG_A, LONG_B, LONG_C, LONG_D];
    const revised = [LONG_A, LONG_C, LONG_D, edited];
    const result = await compareParagraphs(paragraphs(base), paragraphs(revised));
    expect(result.moveFrom).toBeGreaterThan(0);
    expect(result.moveTo).toBeGreaterThan(0);
    expect(texts(acceptAllChanges(result.xml))).toEqual(revised);
    expect(texts(rejectAllChanges(result.xml))).toEqual(base);
  });

  test('a block moved into another section is a move', async () => {
    const sectionBreak = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>';
    const base = paragraphs([LONG_A, LONG_B, LONG_C]) + sectionBreak + paragraphs([LONG_D]);
    const revised = paragraphs([LONG_A]) + sectionBreak + paragraphs([LONG_D, LONG_B, LONG_C]);
    const result = await compareParagraphs(base, revised);
    expect(result.moveFrom).toBeGreaterThanOrEqual(2);
    expect(result.moveTo).toBeGreaterThanOrEqual(2);
    expect(texts(acceptAllChanges(result.xml))).toEqual([LONG_A, '', LONG_D, LONG_B, LONG_C]);
    expect(texts(rejectAllChanges(result.xml))).toEqual([LONG_A, LONG_B, LONG_C, '', LONG_D]);
  });
});
