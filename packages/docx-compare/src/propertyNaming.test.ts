import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from './testing/allure-test.js';
import {
  areRunPropertiesEqual,
  getChangedPropertyNames,
  normalizeRunProperties,
} from './propertyNaming.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const properties = (content: string): Element => parseXml(
  `<w:rPr xmlns:w="${W_NS}">${content}</w:rPr>`,
).documentElement;
const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Portable Property Naming',
});

describe('portable property naming', () => {
  test('normalizes order and prior property-change history', () => {
    const left = properties('<w:i/><w:b/><w:rPrChange w:id="1"><w:rPr/></w:rPrChange>');
    const right = properties('<w:b/><w:i/>');

    expect(areRunPropertiesEqual(left, right)).toBe(true);
    expect(normalizeRunProperties(left)).toEqual(normalizeRunProperties(right));
  });

  test('reports stable friendly run-property names', () => {
    const before = properties('<w:b/><w:strike/><w:caps/><w:rFonts w:ascii="Arial"/>');
    const after = properties('<w:sz w:val="24"/>');

    expect(getChangedPropertyNames(before, after)).toEqual([
      'bold',
      'caps',
      'fontFamily',
      'fontSize',
      'strike',
    ]);
  });

  test('keeps unknown OOXML properties distinguishable', () => {
    expect(getChangedPropertyNames(null, properties('<w:contextualAlternates/>')))
      .toEqual(['w:contextualAlternates']);
  });
});
