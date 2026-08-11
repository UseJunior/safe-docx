/**
 * Generation probes — converter-failure characterization.
 *
 * `probeDocxIdentity` / `probeDocxToPdf` are verification helpers: whatever
 * they call "a pass" is what the generation suite believes about a generated
 * package. Their pass condition used to be "a file exists at the output path",
 * which a converter that failed *after* dropping a partial file satisfies —
 * so a 13-byte truncated stand-in came back as a successful round-trip.
 *
 * These tests drive the probes against a **stub converter** rather than a real
 * LibreOffice, so they run in CI (which installs no LibreOffice) and can
 * script failure modes a real binary will not reproduce on demand. The stub is
 * the reproduction from issue #796, generalized.
 *
 * Every rejection below is paired with a green control that differs from it
 * only in the property under test — a check that cannot go green is as useless
 * as one that cannot go red.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/796
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { createZipBuffer } from '../primitives/zip.js';
import {
  ConvertProbeError,
  probeDocxIdentity,
  probeDocxToPdf,
} from './generation-probes.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure
  .epic('Document Generation')
  .withLabels({ feature: TEST_FEATURE });

let workDir: string;

/**
 * Build an executable stand-in for `soffice`.
 *
 * The stub parses `--outdir` exactly as the real CLI is invoked, writes the
 * caller-supplied bytes to `<outdir>/probe.<ext>` (or writes nothing), emits
 * `stderr`, and exits with `exitCode`. A `/bin/sh` wrapper re-execs the very
 * Node that is running the test, so the stub does not depend on `node` being
 * on PATH.
 */
function makeStubConverter(options: {
  name: string;
  ext: string;
  /** Bytes written to the output path; omit to write no file at all. */
  writes?: Buffer;
  stderr?: string;
  exitCode?: number;
}): string {
  const { name, ext, writes, stderr = '', exitCode = 0 } = options;
  const scriptPath = path.join(workDir, `${name}.mjs`);
  const shimPath = path.join(workDir, name);
  const payload = writes === undefined ? null : writes.toString('base64');

  writeFileSync(
    scriptPath,
    `import { writeFileSync } from 'node:fs';\n` +
      `import path from 'node:path';\n` +
      `const argv = process.argv.slice(2);\n` +
      `const outDir = argv[argv.indexOf('--outdir') + 1];\n` +
      `const payload = ${JSON.stringify(payload)};\n` +
      `if (payload !== null) {\n` +
      `  writeFileSync(path.join(outDir, 'probe.${ext}'), Buffer.from(payload, 'base64'));\n` +
      `}\n` +
      `if (${JSON.stringify(stderr)}) process.stderr.write(${JSON.stringify(stderr)});\n` +
      `process.exit(${exitCode});\n`,
    'utf8',
  );
  writeFileSync(
    shimPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
    'utf8',
  );
  chmodSync(shimPath, 0o755);
  return shimPath;
}

/** A minimal but genuinely readable OPC package. */
async function readablePackage(): Promise<Buffer> {
  return createZipBuffer({
    '[Content_Types].xml':
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    '_rels/.rels':
      `<?xml version="1.0"?><Relationships ` +
      `xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
      `Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      `<?xml version="1.0"?><w:document ` +
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Stub converter output.</w:t></w:r></w:p></w:body></w:document>`,
  });
}

const COMPLETE_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'latin1');
const TRUNCATED_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
/** A `PK\x03\x04` local-file header and nothing else — the issue #796 artifact. */
const TRUNCATED_PACKAGE = Buffer.from('PK\u0003\u0004TRUNCATED', 'latin1');

const GENERATED = Buffer.from('not a real docx — the stub never reads its input');

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'sdx-probe-stub-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('Traceability: generation probes reject failed conversions', () => {
  test('rejects a converter that failed after writing an output file', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The #796 reproduction: a non-zero exit alongside a partial output file.
    // The old pass condition ("a file exists") accepted this.
    const soffice = await given('a converter that writes a truncated docx then exits 1', () =>
      makeStubConverter({
        name: 'fails-after-writing',
        ext: 'docx',
        writes: TRUNCATED_PACKAGE,
        stderr: 'Error: source file could not be loaded\n',
        exitCode: 1,
      }),
    );

    let failure: unknown;
    let returned: unknown;
    await when('the identity probe runs', async () => {
      try {
        returned = await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the exit status and the captured stderr both reach the caller', () => {
      // Stated as a behaviour first: before #796 this resolved, handing back
      // the 11-byte stand-in as `savedPackage`.
      expect(returned).toBeUndefined();
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as ConvertProbeError).diagnostics.exitCode).toBe(1);
      expect((failure as ConvertProbeError).diagnostics.signal).toBeNull();
      expect((failure as ConvertProbeError).diagnostics.output).toContain(
        'source file could not be loaded',
      );
      expect((failure as Error).message).toContain('exit 1');
      expect((failure as Error).message).toContain('source file could not be loaded');
    });
  });

  test('rejects a failed run even when its output would have passed inspection', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Isolates the exit-status check. Every other check in the probe passes
    // on these bytes — the file exists, is non-empty, and is a readable
    // package — so the ONLY thing that can reject this run is the converter's
    // own verdict. Without this case the status check is covered incidentally
    // by artifacts that happen to fail inspection too, and deleting it leaves
    // the suite green.
    const soffice = await given('a converter that writes a readable package then exits 77', async () =>
      makeStubConverter({
        name: 'fails-with-good-output',
        ext: 'docx',
        writes: await readablePackage(),
        stderr: 'Warning: the document was recovered\n',
        exitCode: 77,
      }),
    );

    let failure: unknown;
    let returned: unknown;
    await when('the identity probe runs', async () => {
      try {
        returned = await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('a non-zero exit is disqualifying on its own', () => {
      expect(returned).toBeUndefined();
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as ConvertProbeError).diagnostics.exitCode).toBe(77);
      expect((failure as Error).message).toContain('exit 77');
    });
  });

  test('rejects an empty output file left by a converter that exited 0', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes zero bytes and succeeds', () =>
      makeStubConverter({
        name: 'writes-empty',
        ext: 'docx',
        writes: Buffer.alloc(0),
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('an empty file is not mistaken for a package', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('empty');
    });
  });

  test('rejects a docx that is not a readable package despite a clean exit', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Exit 0, file present, non-zero length — everything the old check looked
    // at. Only reading the package catches this.
    const soffice = await given('a converter that writes a truncated zip and succeeds', () =>
      makeStubConverter({
        name: 'writes-truncated-zip',
        ext: 'docx',
        writes: TRUNCATED_PACKAGE,
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the probe reports an unreadable package rather than a pass', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as ConvertProbeError).diagnostics.exitCode).toBe(0);
      expect((failure as Error).message).toMatch(/not a readable ZIP|no _rels\/\.rels/);
    });
  });

  test('rejects a docx with no package relationships part', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes a zip with no _rels/.rels', async () =>
      makeStubConverter({
        name: 'writes-no-package-rels',
        ext: 'docx',
        writes: await createZipBuffer({ 'word/document.xml': '<w:document/>' }),
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('a readable zip is still not a package', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('_rels/.rels');
    });
  });

  test('rejects a docx whose relationships declare no main document', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes rels without an officeDocument type', async () =>
      makeStubConverter({
        name: 'writes-no-office-document-rel',
        ext: 'docx',
        writes: await createZipBuffer({
          '_rels/.rels':
            `<?xml version="1.0"?><Relationships ` +
            `xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" ` +
            `Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ` +
            `Target="docProps/core.xml"/></Relationships>`,
          'word/document.xml': '<w:document/>',
        }),
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the missing officeDocument relationship is named', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('officeDocument relationship');
    });
  });

  test('rejects a docx whose main-document relationship dangles', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes rels pointing at an absent part', async () =>
      makeStubConverter({
        name: 'writes-dangling-main-part',
        ext: 'docx',
        writes: await createZipBuffer({
          '_rels/.rels':
            `<?xml version="1.0"?><Relationships ` +
            `xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" ` +
            `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
            `Target="word/absent.xml"/></Relationships>`,
          'word/document.xml': '<w:document/>',
        }),
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the probe follows the relationship rather than guessing the path', () => {
      // word/document.xml IS present; only the declared target is absent. A
      // probe that assumed the conventional path would pass this package.
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('word/absent.xml');
    });
  });

  test('rejects a pdf with no %PDF- header', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes non-pdf bytes and succeeds', () =>
      makeStubConverter({
        name: 'writes-headerless-pdf',
        ext: 'pdf',
        writes: Buffer.from('this is not a pdf at all, but it does end with %%EOF', 'latin1'),
      }),
    );

    let failure: unknown;
    await when('the pdf probe runs', async () => {
      try {
        await probeDocxToPdf(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the missing header is reported even though a trailer is present', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('%PDF- header');
    });
  });

  test('rejects a truncated PDF that still carries the %PDF- header', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The magic-byte assertion the PDF probe's caller makes passes on these
    // bytes; only the trailer check does not.
    const soffice = await given('a converter that writes a headed but unterminated pdf', () =>
      makeStubConverter({
        name: 'writes-truncated-pdf',
        ext: 'pdf',
        writes: TRUNCATED_PDF,
      }),
    );

    let failure: unknown;
    await when('the pdf probe runs', async () => {
      try {
        await probeDocxToPdf(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the missing %%EOF trailer is reported', () => {
      expect(TRUNCATED_PDF.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(TRUNCATED_PDF.length).toBeGreaterThan(0);
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as Error).message).toContain('%%EOF');
    });
  });

  test('control: a clean run producing a readable package passes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // Green control for the three docx rejections above. Same stub harness,
    // same code path; only the produced artifact differs.
    const soffice = await given('a converter that writes a readable package and exits 0', async () =>
      makeStubConverter({
        name: 'writes-readable-package',
        ext: 'docx',
        writes: await readablePackage(),
      }),
    );

    const probe = await when('the identity probe runs', () =>
      probeDocxIdentity(GENERATED, soffice),
    );

    await then('the probe returns the saved package and a clean status', () => {
      expect(probe.savedPackage.length).toBeGreaterThan(0);
      expect(probe.diagnostics.exitCode).toBe(0);
      expect(probe.diagnostics.signal).toBeNull();
    });
  });

  test('control: a clean run producing a complete PDF passes', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const soffice = await given('a converter that writes a terminated pdf and exits 0', () =>
      makeStubConverter({
        name: 'writes-complete-pdf',
        ext: 'pdf',
        writes: COMPLETE_PDF,
      }),
    );

    const probe = await when('the pdf probe runs', () => probeDocxToPdf(GENERATED, soffice));

    await then('the probe returns the pdf and a clean status', () => {
      expect(probe.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(probe.diagnostics.exitCode).toBe(0);
    });
  });

  test('rejects a converter that produced no output at all', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The pre-existing load-failure path, kept because real LibreOffice
    // signals a load failure this way: exit 0, stderr text, and no file.
    // The status check added for #796 does not cover it.
    const soffice = await given('a converter that writes nothing and exits 0', () =>
      makeStubConverter({
        name: 'writes-nothing',
        ext: 'docx',
        stderr: 'Error: source file could not be loaded\n',
      }),
    );

    let failure: unknown;
    await when('the identity probe runs', async () => {
      try {
        await probeDocxIdentity(GENERATED, soffice);
      } catch (error) {
        failure = error;
      }
    });

    await then('the load-failure diagnosis still fires, with the stderr attached', () => {
      expect(failure).toBeInstanceOf(ConvertProbeError);
      expect((failure as ConvertProbeError).diagnostics.exitCode).toBe(0);
      expect((failure as Error).message).toContain('likely a load failure');
      expect((failure as Error).message).toContain('source file could not be loaded');
    });
  });
});
