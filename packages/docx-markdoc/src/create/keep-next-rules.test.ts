import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { keptWithNextBeforeStyle } from './keep-next-rules.js';
import { CREATION_STYLE } from './profile.js';
import { lowerCreationMarkdoc } from './lower.js';
import { projectSourceText } from './oracle.js';

const TEST_FEATURE = 'create-automatic-keep-next-rules';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1522 one rule set for create and the round-trip oracle',
  severity: 'critical',
});

/** One paragraph for each automatic keep-with-next rule, and paragraphs next to them that must not be kept. */
const FIXTURE = [
  'Opening paragraph.',
  '',
  'Before the legend.',
  '',
  '{% legend %}Signature page follows.{% /legend %}',
  '',
  '{% run-in-paragraph level="article" heading="Definitions" %}Terms used here.{% /run-in-paragraph %}',
  '',
  '{% run-in-paragraph level="section" heading="Scope" %}Applies to all.{% /run-in-paragraph %}',
  '',
  'Before the first signer.',
  '',
  '{% signer name="Alpha Corp" /%}',
  '',
  '{% signer name="Beta LLC" /%}',
  '',
].join('\n');

describe('automatic keep-with-next', () => {
  test('create and the source oracle keep the same paragraphs with the next', () => {
    const { projection } = lowerCreationMarkdoc(FIXTURE);
    const created = projection.paragraphs.filter((text, index) => text !== '' && projection.layouts[index]?.split(' ').includes('keepNext'));
    const oracle = projectSourceText(FIXTURE).body.filter((entry) => entry.generatedKeepNext).map((entry) => entry.text);
    const covered = ['Before the legend.', 'Definitions', 'Before the first signer.'];
    const has = (texts: string[], start: string) => texts.some((text) => text.includes(start));
    for (const start of covered) {
      expect(has(created, start), `create keeps "${start}"`).toBe(true);
      expect(has(oracle, start), `the oracle marks "${start}"`).toBe(true);
    }
    expect(created.length).toBe(covered.length);
    expect(oracle.length).toBe(covered.length);
  });
});

describe('keptWithNextBeforeStyle', () => {
  test('a paragraph before a legend or signature paragraph is kept with the next; before others it is not', () => {
    expect(keptWithNextBeforeStyle(CREATION_STYLE.legend)).toBe(true);
    expect(keptWithNextBeforeStyle(CREATION_STYLE.signature)).toBe(true);
    expect(keptWithNextBeforeStyle(CREATION_STYLE.body)).toBe(false);
    expect(keptWithNextBeforeStyle(CREATION_STYLE.quote)).toBe(false);
    expect(keptWithNextBeforeStyle(undefined)).toBe(false);
  });
});
