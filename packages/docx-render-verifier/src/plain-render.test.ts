import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { defaultRendererTools } from './render.js';
import { renderPlainPdf } from './plain-render.js';
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

/** Fake soffice writes `pdfBytes` beside the copied input; fake pdftotext returns `text`. */
function fakeTools(text: string, pdfBytes = '%PDF-fake'): RendererTools {
  return {
    resolve: (name) => (name === 'soffice' || name === 'pdftotext' ? `/fake/${name}` : null),
    async run(command, args) {
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
