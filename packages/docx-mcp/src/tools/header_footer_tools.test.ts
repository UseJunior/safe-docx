import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { DocxDocument } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { dispatchToolCall } from '../server.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-header-footer-tools';
const test = testAllure
  .epic('Document Editing')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.2' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const FOOTER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';

type Mgr = ReturnType<typeof createTestSessionManager>;
type Json = Record<string, any>;

function para(text: string, sectPr = ''): string {
  return `<w:p>${sectPr ? `<w:pPr>${sectPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function footerXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${W_NS}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:ftr>`;
}

/** A package with the given body, and footers word/footerN.xml related as rIdF{N}. */
function packageParts(body: string, footers: string[]): { xml: string; extraFiles: Record<string, string> } {
  const rels = footers.map((_, i) => `<Relationship Id="rIdF${i + 1}" Type="${FOOTER_REL}" Target="footer${i + 1}.xml"/>`).join('');
  const overrides = footers.map((_, i) => `<Override PartName="/word/footer${i + 1}.xml" ContentType="${FOOTER_CT}"/>`).join('');
  const extraFiles: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + `${overrides}</Types>`,
    'word/_rels/document.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  };
  footers.forEach((text, i) => { extraFiles[`word/footer${i + 1}.xml`] = footerXml(text); });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;
  return { xml, extraFiles };
}

async function open(body: string, footers: string[], tracked = false) {
  const { xml, extraFiles } = packageParts(body, footers);
  const mgr = createTestSessionManager({ defaultAiAuthor: tracked ? 'SafeDocX AI' : null });
  return openSession([], { mgr, xml, extraFiles });
}

async function call(mgr: Mgr, name: string, args: Json): Promise<Json> {
  return await dispatchToolCall(mgr, name, args) as Json;
}

async function zipTexts(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) out.set(name, await zip.files[name]!.async('string'));
  }
  return out;
}

async function saveAs(mgr: Mgr, inputPath: string, format: 'clean' | 'tracked'): Promise<{ result: Json; buffer: Buffer }> {
  const dir = await createTrackedTempDir('hf-save-');
  const output = path.join(dir, `${format}.docx`);
  const result = await call(mgr, 'save', { file_path: inputPath, save_to_local_path: output, save_format: format });
  assertSuccess(result as { success: boolean }, 'save');
  return { result, buffer: await fs.readFile(output) };
}

function footerText(xml: string): string {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
}

const SECT_FIRST_AND_DEFAULT = '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:footerReference w:type="first" r:id="rIdF2"/><w:titlePg/></w:sectPr>';

describe('Header and footer tools', () => {
  registerCleanup();

  test.openspec('Distinct first-page and default footers are read with paragraph ids')(
    'reports first and default footers with part names, text and _bk_ ids',
    async () => {
      const opened = await open(para('Body text.') + SECT_FIRST_AND_DEFAULT, ['Confidential', 'Cover Page']);
      const result = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      assertSuccess(result as { success: boolean }, 'get_headers_footers');
      const section = result.sections[0];
      expect(section.title_page).toBe(true);
      const byType = Object.fromEntries(section.footers.map((f: Json) => [f.type, f]));
      expect(byType.default).toMatchObject({ relationship_id: 'rIdF1', part_name: 'word/footer1.xml', inherited: false, displayed: true });
      expect(byType.first).toMatchObject({ relationship_id: 'rIdF2', part_name: 'word/footer2.xml', displayed: true });
      expect(byType.default.paragraphs[0].text).toBe('Confidential');
      expect(byType.first.paragraphs[0].text).toBe('Cover Page');
      expect(byType.default.paragraphs[0].id).toMatch(/^_bk_/);
      expect(byType.even).toMatchObject({ relationship_id: null, displayed: false });
    },
  );

  test.openspec('An inheriting section reports the inherited part')(
    'a section without a footer reference reports the previous section footer',
    async () => {
      const body = para('One.', '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>') + para('Two.') + '<w:sectPr/>';
      const opened = await open(body, ['Running footer']);
      const result = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const second = result.sections[1].footers.find((f: Json) => f.type === 'default');
      expect(second).toMatchObject({ part_name: 'word/footer1.xml', inherited: true, source_section_index: 0 });
      expect(second.paragraphs[0].text).toBe('Running footer');
    },
  );

  test.openspec('A tracked footer replacement accepts and rejects to the new and old text')(
    'writes w:del/w:ins into the footer part; accept and reject give new and old text',
    async () => {
      const opened = await open(para('Body.') + '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>', ['Draft of March 1'], true);
      const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const id = read.sections[0].footers[0].paragraphs[0].id;
      const edit = await call(opened.mgr, 'replace_text', {
        file_path: opened.inputPath, target_paragraph_id: id, old_string: 'March 1', new_string: 'April 2', instruction: 'update footer date',
      });
      assertSuccess(edit as { success: boolean }, 'replace_text');
      expect(edit.part_name).toBe('word/footer1.xml');
      const { buffer } = await saveAs(opened.mgr, opened.inputPath, 'tracked');
      const footer = (await zipTexts(buffer)).get('word/footer1.xml')!;
      expect(footer).toContain('<w:del ');
      expect(footer).toContain('<w:ins ');
      expect(footer).not.toContain('_bk_');

      const accepted = await DocxDocument.load(buffer);
      await accepted.acceptChanges();
      const rejected = await DocxDocument.load(buffer);
      await rejected.rejectChanges();
      const acceptedFooter = (await zipTexts((await accepted.toBuffer()).buffer)).get('word/footer1.xml')!;
      const rejectedFooter = (await zipTexts((await rejected.toBuffer()).buffer)).get('word/footer1.xml')!;
      expect(footerText(acceptedFooter)).toBe('Draft of April 2');
      expect(footerText(rejectedFooter)).toBe('Draft of March 1');
    },
  );

  test.openspec('A clean save keeps untouched parts byte-identical')(
    'only document.xml and the edited footer differ from the input',
    async () => {
      const body = para('Body.') + SECT_FIRST_AND_DEFAULT;
      const opened = await open(body, ['Confidential', 'Cover Page']);
      const input = await zipTexts(await fs.readFile(opened.inputPath));
      const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const first = read.sections[0].footers.find((f: Json) => f.type === 'first');
      const edit = await call(opened.mgr, 'replace_text', {
        file_path: opened.inputPath, target_paragraph_id: first.paragraphs[0].id, old_string: 'Cover', new_string: 'Title', instruction: 'rename',
      });
      assertSuccess(edit as { success: boolean }, 'replace_text');
      const inserted = await call(opened.mgr, 'insert_paragraph', {
        file_path: opened.inputPath, positional_anchor_node_id: first.paragraphs[0].id, new_string: 'Second line', instruction: 'add line',
      });
      assertSuccess(inserted as { success: boolean }, 'insert_paragraph');
      const output = await zipTexts((await saveAs(opened.mgr, opened.inputPath, 'clean')).buffer);
      for (const [name, text] of input) {
        if (name === 'word/document.xml' || name === 'word/footer2.xml') continue;
        expect(output.get(name), name).toBe(text);
      }
      expect(footerText(output.get('word/footer2.xml')!)).toBe('Title PageSecond line');
      expect(output.get('word/footer2.xml')).not.toContain('_bk_');
    },
  );

  test.openspec('batch_edit refuses header and footer anchors')(
    'fails validation naming the single-edit tools',
    async () => {
      const opened = await open(para('Body.') + '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>', ['Footer']);
      const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const id = read.sections[0].footers[0].paragraphs[0].id;
      const result = await call(opened.mgr, 'batch_edit', {
        file_path: opened.inputPath,
        steps: [{ step_id: 's1', operation: 'replace_text', target_paragraph_id: id, old_string: 'Footer', new_string: 'X', instruction: 'x' }],
      });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain('use replace_text or insert_paragraph');
    },
  );

  test.openspec('Per-section footers after a section break')(
    'issue #1200: page-number footer on section 0, "Signature Page" footer on section 1',
    async () => {
      const opened = await open(para('Page one.') + para('Page two.') + para('Page three.') + '<w:sectPr/>', []);
      const ids = opened.paraIds;
      const brk = await call(opened.mgr, 'insert_section_break', { file_path: opened.inputPath, paragraph_id: ids[1], break_type: 'nextPage' });
      assertSuccess(brk as { success: boolean }, 'insert_section_break');
      const s0 = await call(opened.mgr, 'set_header_footer', {
        file_path: opened.inputPath, kind: 'footer', section_index: 0, paragraphs: [{ alignment: 'center', runs: [{ field: 'PAGE' }] }],
      });
      assertSuccess(s0 as { success: boolean }, 'set_header_footer');
      // Section 1 had no footer; it is pinned to an empty part so it stays blank.
      expect(s0.pinned_sections).toEqual([expect.objectContaining({ section_index: 1, part_created: true })]);
      const s1 = await call(opened.mgr, 'set_header_footer', {
        file_path: opened.inputPath, kind: 'footer', section_index: 1, paragraphs: [{ alignment: 'center', text: 'Signature Page' }],
      });
      assertSuccess(s1 as { success: boolean }, 'set_header_footer');

      const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const def = (i: number) => read.sections[i].footers.find((f: Json) => f.type === 'default');
      expect(def(0).inherited).toBe(false);
      expect(def(1).inherited).toBe(false);
      expect(def(1).paragraphs.map((p: Json) => p.text)).toEqual(['Signature Page']);

      const { result, buffer } = await saveAs(opened.mgr, opened.inputPath, 'clean');
      expect(JSON.stringify(result)).toContain('set_header_footer');
      const out = await zipTexts(buffer);
      // Section 1's pinned empty part is rewritten, not orphaned.
      expect(s1.part_name).toBe(s0.pinned_sections[0].part_name);
      expect([...out.keys()].filter((n) => /^word\/footer\d+\.xml$/.test(n))).toHaveLength(2);
      const doc = out.get('word/document.xml')!;
      const rels = out.get('word/_rels/document.xml.rels')!;
      const ct = out.get('[Content_Types].xml')!;
      const s0Part = s0.part_name as string;
      const s1Part = s1.part_name as string;
      expect(out.get(s0Part)).toContain('<w:instrText xml:space="preserve"> PAGE </w:instrText>');
      expect(out.get(s0Part)).toContain('<w:jc w:val="center"/>');
      expect(footerText(out.get(s1Part)!)).toBe('Signature Page');
      for (const [part, rid] of [[s0Part, s0.relationship_id], [s1Part, s1.relationship_id]] as const) {
        expect(rels.match(new RegExp(`Id="${rid}"`, 'g'))).toHaveLength(1);
        expect(rels).toContain(`Target="${part.slice('word/'.length)}"`);
        expect(ct.match(new RegExp(`PartName="/${part}"`, 'g'))).toHaveLength(1);
      }
      const sectPrs = [...doc.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>|<w:sectPr\/>/g)].map((m) => m[0]);
      expect(sectPrs[0]).toContain(`r:id="${s0.relationship_id}"`);
      expect(sectPrs[1]).toContain(`r:id="${s1.relationship_id}"`);
    },
  );

  test.openspec('Attaching to a middle section keeps the following sections')(
    'the third section is pinned to the original inherited footer',
    async () => {
      const body = para('A.', '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>')
        + para('B.', '<w:sectPr/>') + para('C.') + '<w:sectPr/>';
      const opened = await open(body, ['Original']);
      const set = await call(opened.mgr, 'set_header_footer', {
        file_path: opened.inputPath, kind: 'footer', section_index: 1, paragraphs: [{ text: 'Middle' }],
      });
      assertSuccess(set as { success: boolean }, 'set_header_footer');
      expect(set.pinned_sections).toEqual([{ section_index: 2, relationship_id: 'rIdF1', part_name: 'word/footer1.xml', part_created: false }]);
      const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
      const def = (i: number) => read.sections[i].footers.find((f: Json) => f.type === 'default');
      expect(def(0).part_name).toBe('word/footer1.xml');
      expect(def(1).paragraphs[0].text).toBe('Middle');
      expect(def(2)).toMatchObject({ part_name: 'word/footer1.xml', inherited: false });

      // Linking the middle section back restores inheritance from section 0.
      const link = await call(opened.mgr, 'set_header_footer', {
        file_path: opened.inputPath, kind: 'footer', section_index: 1, link_to_previous: true,
      });
      assertSuccess(link as { success: boolean }, 'set_header_footer');
      expect(link).toMatchObject({ relationship_id: 'rIdF1', pinned_sections: [] });
    },
  );

  test.openspec('Tracked mode records the section change')(
    'a first-page footer sets titlePg and records w:sectPrChange',
    async () => {
      const opened = await open(para('Body.') + '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>', ['Default'], true);
      const set = await call(opened.mgr, 'set_header_footer', {
        file_path: opened.inputPath, kind: 'footer', section_index: 0, type: 'first', paragraphs: [{ text: 'Cover' }],
      });
      assertSuccess(set as { success: boolean }, 'set_header_footer');
      expect(set).toMatchObject({ title_page_set: true, tracked: true });
      const doc = (await zipTexts((await saveAs(opened.mgr, opened.inputPath, 'tracked')).buffer)).get('word/document.xml')!;
      expect(doc).toMatch(/<w:footerReference w:type="first" r:id="rId\d+"\/>/);
      expect(doc).toContain('<w:titlePg/>');
      expect(doc).toMatch(/<w:sectPrChange [^>]*w:author="SafeDocX AI"[^>]*><w:sectPr><w:pgSz w:w="12240" w:h="15840"\/><\/w:sectPr><\/w:sectPrChange>/);
    },
  );

  test('new content for a session-created part another section inherits gets its own part', async () => {
    const body = para('A.', '<w:sectPr/>') + para('B.') + '<w:sectPr/>';
    const opened = await open(body, []);
    const first = await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, paragraphs: [{ text: 'Original' }] });
    await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 1, link_to_previous: true });
    const again = await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, paragraphs: [{ text: 'Replacement' }] });
    expect(again.part_name).not.toBe(first.part_name);
    expect(again.pinned_sections).toEqual([expect.objectContaining({ section_index: 1, part_name: first.part_name })]);
    const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
    const def = (i: number) => read.sections[i].footers.find((f: Json) => f.type === 'default');
    expect(def(0).paragraphs[0].text).toBe('Replacement');
    expect(def(1).paragraphs[0].text).toBe('Original');
  });

  test('reject_ai_edits reaches a tracked edit in a footer attached this session', async () => {
    const opened = await open(para('Body.') + '<w:sectPr/>', [], true);
    await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, paragraphs: [{ text: 'Old' }] });
    const read = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
    const id = read.sections[0].footers[0].paragraphs[0].id;
    await call(opened.mgr, 'replace_text', { file_path: opened.inputPath, target_paragraph_id: id, old_string: 'Old', new_string: 'New', instruction: 'x' });
    const rejected = await call(opened.mgr, 'reject_ai_edits', { file_path: opened.inputPath, author: 'SafeDocX AI' });
    expect(rejected.insertionsRemoved).toBeGreaterThan(0);
    const after = await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
    expect(after.sections[0].footers[0].paragraphs[0].text).toBe('Old');
  });

  test('refuses to stack an AI section change on another author\'s sectPrChange', async () => {
    const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/><w:sectPrChange w:id="90" w:author="Alice" w:date="2026-01-01T00:00:00Z"><w:sectPr/></w:sectPrChange></w:sectPr>';
    const opened = await open(para('Body.') + sect, ['Default'], true);
    const result = await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, type: 'first', paragraphs: [{ text: 'Cover' }] }).catch((e) => e);
    assertFailure(result as any, 'CONFLICTING_SECTION_REVISION');
  });

  test('a reference-only change is listed in the save manifest', async () => {
    const body = para('A.', '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>') + para('B.') + '<w:sectPr><w:footerReference w:type="default" r:id="rIdF2"/></w:sectPr>';
    const opened = await open(body, ['One', 'Two']);
    const set = await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 1, existing_relationship_id: 'rIdF1' });
    expect(set.parts_created).toEqual([]);
    const { result } = await saveAs(opened.mgr, opened.inputPath, 'clean');
    expect(JSON.stringify(result.non_revision_changes)).toContain('reference set to rIdF1');
  });

  test('reading headers and footers adds nothing to a session comparison', async () => {
    const opened = await open(para('Body.') + '<w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>', ['Footer text']);
    await call(opened.mgr, 'get_headers_footers', { file_path: opened.inputPath });
    const dir = await createTrackedTempDir('hf-compare-');
    const compared = await call(opened.mgr, 'compare_documents', { file_path: opened.inputPath, save_to_local_path: path.join(dir, 'cmp.docx') });
    assertSuccess(compared as { success: boolean }, 'compare_documents');
    expect(JSON.stringify(compared.stats ?? compared)).toMatch(/"insertions":0/);
  });

  test('refuses invalid requests before touching the session', async () => {
    const opened = await open(para('Body.') + '<w:sectPr/>', []);
    assertFailure(await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0 }) as any, 'VALIDATION_ERROR');
    assertFailure(await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 5, paragraphs: [{ text: 'x' }] }) as any, 'SECTION_NOT_FOUND');
    assertFailure(await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, link_to_previous: true }) as any, 'INVALID_HEADER_FOOTER_REQUEST');
    assertFailure(await call(opened.mgr, 'set_header_footer', { file_path: opened.inputPath, kind: 'footer', section_index: 0, existing_relationship_id: 'rId99' }) as any, 'RELATIONSHIP_NOT_FOUND');
  });
});
