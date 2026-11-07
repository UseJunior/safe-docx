import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { CompileContext } from './context.js';
import { GenerationInternalError } from './errors.js';
import { generateDocx } from './compile.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

describe('CompileContext generation part allocation and finalization invariants (#1315)', () => {
  test.openspec('reserving part names prevents dynamic allocator collisions')(
    'reserving part names prevents dynamic allocator collisions',
    async ({ given, when, then }: AllureBddContext) => {
      const ctx = new CompileContext();

      await given('part names word/header1.xml and word/footer2.xml are reserved', async () => {
        ctx.reservePartName('word/header1.xml');
        ctx.reservePartName('/word/footer2.xml');
      });

      await then('isPartNameReserved and isPartNameClaimed return true', async () => {
        expect(ctx.isPartNameReserved('word/header1.xml')).toBe(true);
        expect(ctx.isPartNameReserved('/word/header1.xml')).toBe(true);
        expect(ctx.isPartNameClaimed('word/footer2.xml')).toBe(true);
        expect(ctx.isPartNameReserved('word/header2.xml')).toBe(false);
      });

      await when('headers and footers are dynamically allocated', async () => {
        const h1 = ctx.allocateHeaderPartName();
        const f1 = ctx.allocateFooterPartName();
        const f2 = ctx.allocateFooterPartName();

        expect(h1).toBe('word/header2.xml');
        expect(f1).toBe('word/footer1.xml');
        expect(f2).toBe('word/footer3.xml');
      });

      await then('reserving empty part name is rejected', async () => {
        expect(() => ctx.reservePartName('')).toThrow(GenerationInternalError);
        expect(() => ctx.reservePartName('///')).toThrow(GenerationInternalError);
      });
    },
  );

  test.openspec('conflicting part registrations are rejected with GenerationInternalError')(
    'conflicting part registrations are rejected with GenerationInternalError',
    async ({ given, then }: AllureBddContext) => {
      const ctx = new CompileContext();

      await given('a part is registered with specific content type and relationship', async () => {
        const part = ctx.registerPart('word/header1.xml', 'application/vnd.header', 'http://rel/header');
        expect(part.name).toBe('word/header1.xml');
        expect(part.contentType).toBe('application/vnd.header');
        expect(part.documentRel?.rId).toBe('rId1');
      });

      await then('re-registering with identical attributes is idempotent and returns existing part', async () => {
        const same = ctx.registerPart('word/header1.xml', 'application/vnd.header', 'http://rel/header');
        expect(same.documentRel?.rId).toBe('rId1');
        expect(ctx.registeredParts()).toHaveLength(1);
      });

      await then('registering with conflicting content type is rejected', async () => {
        expect(() =>
          ctx.registerPart('word/header1.xml', 'application/vnd.other', 'http://rel/header'),
        ).toThrow(GenerationInternalError);
      });

      await then('registering with conflicting relationship type is rejected', async () => {
        expect(() =>
          ctx.registerPart('word/header1.xml', 'application/vnd.header', 'http://rel/different'),
        ).toThrow(GenerationInternalError);
        expect(() => ctx.registerPart('word/header1.xml', 'application/vnd.header')).toThrow(
          GenerationInternalError,
        );
      });

      await then('registering empty part name is rejected', async () => {
        expect(() => ctx.registerPart('', 'application/xml')).toThrow(GenerationInternalError);
      });
    },
  );

  test.openspec('finalization rejects missing [Content_Types].xml and registered parts lacking content')(
    'finalization rejects missing [Content_Types].xml and registered parts lacking content',
    async ({ given, then }: AllureBddContext) => {
      const ctx1 = new CompileContext();
      ctx1.setFileContent('word/document.xml', '<document/>');

      await then('toFileRecord throws if [Content_Types].xml was never emitted', async () => {
        expect(() => ctx1.toFileRecord()).toThrow(GenerationInternalError);
        expect(() => ctx1.toFileRecord()).toThrow('[Content_Types].xml was never emitted');
      });

      const ctx2 = new CompileContext();
      ctx2.registerPart('word/header1.xml', 'application/vnd.header', 'http://rel/header');
      ctx2.setFileContent('[Content_Types].xml', '<Types/>');
      ctx2.setFileContent('word/document.xml', '<document/>');

      await then('toFileRecord throws if registered part lacks content in file map', async () => {
        expect(() => ctx2.toFileRecord()).toThrow(GenerationInternalError);
        expect(() => ctx2.toFileRecord()).toThrow("registered part 'word/header1.xml' lacks content");
      });

      await given('content for word/header1.xml is provided', async () => {
        ctx2.setFileContent('word/header1.xml', '<header/>');
        const record = ctx2.toFileRecord();
        expect(record['[Content_Types].xml']).toBe('<Types/>');
        expect(record['word/header1.xml']).toBe('<header/>');
        expect(record['word/document.xml']).toBe('<document/>');
      });
    },
  );

  test.openspec('finalization locks context against post-finalization mutations')(
    'finalization locks context against post-finalization mutations',
    async ({ given, then }: AllureBddContext) => {
      const ctx = new CompileContext();
      ctx.setFileContent('[Content_Types].xml', '<Types/>');
      ctx.setFileContent('word/document.xml', '<doc/>');

      expect(ctx.isFinalized()).toBe(false);
      const record = ctx.toFileRecord();
      expect(ctx.isFinalized()).toBe(true);

      await then('subsequent mutating operations throw GenerationInternalError', async () => {
        expect(() => ctx.reservePartName('word/header1.xml')).toThrow(GenerationInternalError);
        expect(() => ctx.registerPart('word/footer1.xml', 'app/footer')).toThrow(
          GenerationInternalError,
        );
        expect(() => ctx.allocateRid()).toThrow(GenerationInternalError);
        expect(() => ctx.allocateHeaderPartName()).toThrow(GenerationInternalError);
        expect(() => ctx.allocateFooterPartName()).toThrow(GenerationInternalError);
        expect(() => ctx.setFileContent('word/styles.xml', '<styles/>')).toThrow(
          GenerationInternalError,
        );
      });

      await then('read-only inspection and toFileRecord remain idempotent and accessible', async () => {
        expect(ctx.getFileContent('word/document.xml')).toBe('<doc/>');
        expect(ctx.toFileRecord()).toEqual(record);
      });
    },
  );

  test.openspec('deterministic ID allocation and file ordering are preserved')(
    'deterministic ID allocation and file ordering are preserved',
    async ({ then }: AllureBddContext) => {
      const ctx = new CompileContext();
      const r1 = ctx.allocateRid();
      const r2 = ctx.allocateRid();
      const r3 = ctx.allocateRid();

      expect(r1).toBe('rId1');
      expect(r2).toBe('rId2');
      expect(r3).toBe('rId3');

      ctx.setFileContent('word/document.xml', '<doc/>');
      ctx.setFileContent('word/styles.xml', '<styles/>');
      ctx.setFileContent('[Content_Types].xml', '<Types/>');
      ctx.setFileContent('docProps/core.xml', '<core/>');

      const record = ctx.toFileRecord();
      const keys = Object.keys(record);

      then('[Content_Types].xml is strictly first followed by insertion order', () => {
        expect(keys[0]).toBe('[Content_Types].xml');
        expect(keys.slice(1)).toEqual(['word/document.xml', 'word/styles.xml', 'docProps/core.xml']);
      });
    },
  );

  test.openspec('end-to-end generateDocx satisfies CompileContext invariants')(
    'end-to-end generateDocx satisfies CompileContext invariants',
    async ({ then }: AllureBddContext) => {
      const spec: DocumentSpec = {
        meta: { title: 'Test Document', author: 'Agent 3' },
        sections: [
          {
            headers: { default: { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Header Text' }] }] } },
            blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Hello World' }] }],
          },
        ],
      };

      const buffer = await generateDocx(spec);
      then('compiles successfully into a non-empty buffer', () => {
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
      });
    },
  );
});
