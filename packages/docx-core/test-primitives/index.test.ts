import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import * as primitives from '../src/primitives/index.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Public API Surface' });

describe('index exports', () => {
  test('re-exports key public surface symbols', async ({ given, when, then }: AllureBddContext) => {
    await given('the primitives index module is imported', async () => {});
    await when('the exported symbols are inspected', async () => {});
    await then('all key public surface symbols are exported as functions', () => {
      expect(typeof primitives.DocxDocument).toBe('function');
      expect(typeof primitives.parseXml).toBe('function');
      expect(typeof primitives.serializeXml).toBe('function');
      expect(typeof primitives.getParagraphRuns).toBe('function');
      expect(typeof primitives.parseNumberingXml).toBe('function');
      expect(typeof primitives.validateDocument).toBe('function');
    });
  });
});
