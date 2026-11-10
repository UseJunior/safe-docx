import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { CompileContext } from './context.js';
import { GenerationInternalError } from './errors.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

describe('generation context invariants', () => {
  test('reserves allocated names and skips explicitly registered or written parts', () => {
    const ctx = new CompileContext();
    ctx.registerPart('word/header1.xml', 'header');
    ctx.setFileContent('word/header2.xml', '<header/>');
    expect(ctx.allocateHeaderPartName()).toBe('word/header3.xml');
    expect(ctx.allocateHeaderPartName()).toBe('word/header4.xml');
    ctx.setFileContent('word/footer1.xml', '<footer/>');
    ctx.registerPart('word/footer2.xml', 'footer');
    expect(ctx.allocateFooterPartName()).toBe('word/footer3.xml');
    expect(ctx.allocateFooterPartName()).toBe('word/footer4.xml');
    // Allocation alone must not promise an Override or consume a relationship id.
    expect(ctx.registeredParts().map((part) => part.name)).toEqual(['word/header1.xml', 'word/footer2.xml']);
    expect(ctx.allocateRid()).toBe('rId1');
    const independent = new CompileContext();
    expect(independent.allocateHeaderPartName()).toBe('word/header1.xml');
    expect(independent.allocateFooterPartName()).toBe('word/footer1.xml');
  });

  test('allows identical registrations but rejects conflicting metadata', () => {
    const ctx = new CompileContext();
    const part = ctx.registerPart('word/header1.xml', 'header', 'rel-header');
    expect(ctx.registerPart('word/header1.xml', 'header', 'rel-header')).toBe(part);
    expect(part.documentRel?.rId).toBe('rId1');
    expect(() => ctx.registerPart('word/header1.xml', 'other', 'rel-header')).toThrow(GenerationInternalError);
    expect(() => ctx.registerPart('word/header1.xml', 'header', 'rel-other')).toThrow(GenerationInternalError);
    expect(() => ctx.registerPart('word/header1.xml', 'header')).toThrow(GenerationInternalError);
    const unattached = ctx.registerPart('word/custom.xml', 'custom');
    expect(ctx.registerPart('word/custom.xml', 'custom')).toBe(unattached);
    expect(() => ctx.registerPart('word/custom.xml', 'custom', 'rel-custom')).toThrow(GenerationInternalError);
    expect(ctx.registeredParts()).toEqual([part, unattached]);
    expect(ctx.documentRelParts()).toEqual([part]);
    expect(ctx.registerPart('word/footer1.xml', 'footer', 'rel-footer').documentRel?.rId).toBe('rId2');
    expect(ctx.allocateRid()).toBe('rId3');
  });

  test.openspec('[SDX-GEN-014] registered parts require content before assembly')('requires registered content and allows recovery after failed assembly', () => {
    const ctx = new CompileContext();
    ctx.setFileContent('[Content_Types].xml', '<Types/>');
    ctx.registerPart('word/header1.xml', 'header');
    expect(() => ctx.toFileRecord()).toThrow(GenerationInternalError);
    expect(() => ctx.toFileRecord()).toThrow('Registered part has no content: word/header1.xml');
    ctx.setFileContent('word/header1.xml', '<header/>');
    expect(Object.keys(ctx.toFileRecord())).toEqual(['[Content_Types].xml', 'word/header1.xml']);
  });

  test('keeps reservations separate and orders content types first without reordering files', () => {
    const ctx = new CompileContext();
    const header = ctx.allocateHeaderPartName();
    ctx.allocateFooterPartName(); // An unused reservation is not a registered part.
    ctx.registerPart(header, 'header', 'rel-header');
    ctx.setFileContent('word/document.xml', '<document/>');
    ctx.setFileContent(header, '<header/>');
    ctx.setFileContent('[Content_Types].xml', '<Types/>');
    ctx.setFileContent('word/empty.xml', '');
    ctx.registerPart('word/empty.xml', 'empty');
    ctx.setFileContent('word/document.xml', '<updated/>');
    const record = ctx.toFileRecord();
    expect(Object.keys(record)).toEqual(['[Content_Types].xml', 'word/document.xml', header, 'word/empty.xml']);
    expect(record['word/document.xml']).toBe('<updated/>');
    expect(record['word/empty.xml']).toBe('');
    expect(ctx.toFileRecord()).toEqual(record);
    expect(ctx.allocateRid()).toBe('rId2');
  });

  test('reports missing content types as an internal error and permits retry', () => {
    const ctx = new CompileContext();
    expect(() => ctx.toFileRecord()).toThrow(GenerationInternalError);
    expect(() => ctx.toFileRecord()).toThrow('[Content_Types].xml was never emitted');
    ctx.setFileContent('[Content_Types].xml', '<Types/>');
    expect(ctx.toFileRecord()).toEqual({ '[Content_Types].xml': '<Types/>' });
  });
});
