import { describe, expect } from 'vitest';
import { itAllure as it } from './helpers/allure-test.js';
import * as primitives from '../src/primitives/index.js';

describe('index exports', () => {
  it('re-exports key public surface symbols', () => {
    expect(typeof primitives.DocxDocument).toBe('function');
    expect(typeof primitives.parseXml).toBe('function');
    expect(typeof primitives.serializeXml).toBe('function');
    expect(typeof primitives.getParagraphRuns).toBe('function');
    expect(typeof primitives.parseNumberingXml).toBe('function');
    expect(typeof primitives.validateDocument).toBe('function');
  });
});
