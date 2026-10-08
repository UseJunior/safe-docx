import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { defaultRendererTools } from './render.js';
import { renderPlainPdf, splitPdfTextPages } from './plain-render.js';
import type { RendererTools } from './types.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<{ docx: string; pdf: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'plain-render-test-'));
  dirs.push(dir);
  const docx = path.join(dir, 'doc.docx');
  await writeFile(docx, 'not inspected by the fake renderer');
  return { docx, pdf: path.join(dir, 'doc.pdf') };
}

type Call = { command: string; args: string[] };

/** Fake soffice writes `pdfBytes` beside the copied input; fake pdftotext returns `text`. Records every call. */
function fakeTools(text: string, pdfBytes = '%PDF-fake', calls: Call[] = []): RendererTools {
  return {
    resolve: (name) => (name === 'soffice' || name === 'pdftotext' ? `/fake/${name}` : null),
    async run(command, args) {
      calls.push({ command, args: [...args] });
      if (command.endsWith('soffice')) {
        const outdir = args[args.indexOf('--outdir') + 1]!;
        await mkdir(outdir, { recursive: true });
        await writeFile(path.join(outdir, 'input.pdf'), pdfBytes);
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: text, stderr: '' };
    },
  };
}

describe('plain PDF render for finished non-tracked documents', () => {
  itAllure('reports not_run, never a pass, when LibreOffice or pdftotext is missing', async () => {
    const { docx, pdf } = await workspace();
    const verdict = await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['x'], tools: { resolve: () => null, run: async () => ({ code: 1, stdout: '', stderr: '' }) } });
    expect(verdict).toEqual({ status: 'not_run', reason: 'missing tools: soffice, pdftotext' });
    expect(existsSync(pdf)).toBe(false);
  });

  itAllure('passes when every required text appears, comparing with collapsed whitespace, and counts pages', async () => {
    const { docx, pdf } = await workspace();
    const verdict = await renderPlainPdf({
      docxPath: docx,
      outputPdfPath: pdf,
      requiredText: ['ACME WIDGETS INC.', '____\nJane Roe\tDate: __', '[Signature Page]'],
      tools: fakeTools('ACME   WIDGETS INC.\n body\f____\nJane Roe      Date: __\n[Signature Page]\n\f'),
    });
    expect(verdict).toMatchObject({ status: 'passed', pageCount: 2 });
    expect(verdict.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(pdf, 'utf8')).toBe('%PDF-fake');
  });

  itAllure('renders a private copy in a fresh profile and removes the workspace afterwards', async () => {
    const { docx, pdf } = await workspace();
    const calls: Call[] = [];
    await Promise.all([
      renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: [], tools: fakeTools('x', '%PDF-fake', calls) }),
      renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.b`, requiredText: [], tools: fakeTools('x', '%PDF-fake', calls) }),
    ]);
    const renders = calls.filter((call) => call.command.endsWith('soffice'));
    const inputs = renders.map((call) => call.args.at(-1)!);
    const profiles = renders.map((call) => call.args.find((arg) => arg.startsWith('-env:UserInstallation=file://'))!);
    expect(inputs.every((input) => input !== docx && input.endsWith('input.docx'))).toBe(true);
    expect(new Set(inputs).size).toBe(2);
    expect(new Set(profiles).size).toBe(2);
    expect(inputs.some((input) => existsSync(path.dirname(input)))).toBe(false);
    const thrower: RendererTools = { resolve: (name) => `/fake/${name}`, run: async (_command, args) => { calls.push({ command: 'throw', args }); throw new Error('boom'); } };
    await expect(renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.c`, requiredText: [], tools: thrower })).rejects.toThrow('boom');
    expect(existsSync(path.dirname(calls.at(-1)!.args.at(-1)!))).toBe(false);
  });

  itAllure('counts blank pages and refuses to match text across a page break', async () => {
    expect(splitPdfTextPages('Title\f\fSignature\f')).toEqual(['Title', '', 'Signature']);
    expect(splitPdfTextPages('Only page')).toEqual(['Only page']);
    const { docx, pdf } = await workspace();
    const blank = await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['Signature'], tools: fakeTools('Title\f\fSignature\f') });
    expect(blank).toMatchObject({ status: 'passed', pageCount: 3 });
    const split = await renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.2`, requiredText: ['Approval granted'], tools: fakeTools('Approval\fgranted\f') });
    expect(split).toMatchObject({ status: 'failed', missingText: ['Approval granted'] });
  });

  itAllure('never writes the PDF on a failed check and refuses an output that aliases the input', async () => {
    const { docx, pdf } = await workspace();
    await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['Absent'], tools: fakeTools('Present\f') });
    expect(existsSync(pdf)).toBe(false);
    await writeFile(pdf, 'previous');
    await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['Absent'], tools: fakeTools('Present\f') });
    expect(await readFile(pdf, 'utf8')).toBe('previous');
    await expect(renderPlainPdf({ docxPath: docx, outputPdfPath: docx, requiredText: [], tools: fakeTools('x') })).rejects.toThrow(/alias/);
    const link = `${docx}.link.pdf`;
    await symlink(docx, link);
    await expect(renderPlainPdf({ docxPath: docx, outputPdfPath: link, requiredText: [], tools: fakeTools('x') })).rejects.toThrow(/alias/);
    expect(await readFile(docx, 'utf8')).toBe('not inspected by the fake renderer');
  });

  itAllure('never writes through an output alias that appears while rendering', async () => {
    for (const makeAlias of [symlink, link] as const) {
      const { docx, pdf } = await workspace();
      const before = await readFile(docx);
      // The destination does not exist when the call starts; it becomes an alias of the input mid-render.
      const racing = fakeTools('Present\f');
      const run = racing.run;
      racing.run = async (command, args) => {
        if (command.endsWith('soffice')) await makeAlias(docx, pdf);
        return run(command, args);
      };
      const verdict = await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['Present'], tools: racing });
      expect(verdict.status, makeAlias.name).toBe('passed');
      expect(await readFile(docx), makeAlias.name).toEqual(before);
      expect(await readFile(pdf, 'utf8'), makeAlias.name).toBe('%PDF-fake');
      expect((await readdir(path.dirname(pdf))).filter((name) => name.endsWith('.tmp')), makeAlias.name).toEqual([]);
    }
  });

  itAllure('fails and names missing text, and fails an empty text layer', async () => {
    const { docx, pdf } = await workspace();
    const missing = await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['Title', 'Footer text'], tools: fakeTools('Title only') });
    expect(missing).toMatchObject({ status: 'failed', missingText: ['Footer text'] });
    const empty = await renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.2`, requiredText: [], tools: fakeTools(' \f ') });
    expect(empty).toMatchObject({ status: 'failed', reason: 'PDF text layer is empty' });
    const zero = await renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.3`, requiredText: [], tools: fakeTools('text', '') });
    expect(zero).toMatchObject({ status: 'failed', reason: 'LibreOffice produced an empty PDF' });
  });

});

const realTools = defaultRendererTools();
const describeWithLibreOffice = realTools.resolve('soffice') && realTools.resolve('pdftotext') ? describe : describe.skip;

describeWithLibreOffice('plain PDF render with a real LibreOffice', () => {
  itAllure('renders a real two-paragraph DOCX through LibreOffice and finds both paragraphs', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>ACME WIDGETS INC.</w:t></w:r></w:p><w:p><w:r><w:t>The Board approves the plan.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    const { docx, pdf } = await workspace();
    await writeFile(docx, await zip.generateAsync({ type: 'nodebuffer' }));
    const verdict = await renderPlainPdf({ docxPath: docx, outputPdfPath: pdf, requiredText: ['ACME WIDGETS INC.', 'The Board approves the plan.'] });
    expect(verdict).toMatchObject({ status: 'passed', pageCount: 1 });
    expect(existsSync(pdf)).toBe(true);
    const missing = await renderPlainPdf({ docxPath: docx, outputPdfPath: `${pdf}.2`, requiredText: ['Not in the document'] });
    expect(missing).toMatchObject({ status: 'failed', missingText: ['Not in the document'] });
  }, 120_000);
});
