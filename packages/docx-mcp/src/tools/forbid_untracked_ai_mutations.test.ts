import { describe, expect } from 'vitest';
import {
  DocxZip,
  TRACKED_CHANGE_ELEMENT_NAME_SET,
  parseXml,
  type DocxDocument,
} from '@usejunior/docx-core';
import { SessionManager, type DocxSession } from '../session/manager.js';
import { TOOL_SURFACE_INDEX, SAFE_DOCX_MCP_TOOLS } from '../tool_catalog.js';
import { addComment } from './add_comment.js';
import { addFootnote } from './add_footnote.js';
import { deleteComment } from './delete_comment.js';
import { batchEdit } from './batch_edit.js';
import { clearFormatting } from './clear_formatting.js';
import { formatLayout } from './format_layout.js';
import { formatNumbering } from './format_numbering.js';
import { formatSection } from './format_section.js';
import { insertSectionBreakTool } from './insert_section_break.js';
import { insertParagraph } from './insert_paragraph.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTrackedTempDir,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// OpenSpec traceability: forbid-untracked-ai-mutations
const TEST_FEATURE = 'forbid-untracked-ai-mutations';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';

const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

function aiManager(): SessionManager {
  return new SessionManager({ defaultAiAuthor: AI });
}

function documentXml(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

async function docxSession(mgr: SessionManager, filePath: string): Promise<DocxSession> {
  const session = await mgr.getSessionByFilePath(filePath);
  if (!session || session.provider !== 'docx') throw new Error('Expected DOCX session');
  return session;
}

/**
 * Count tracked-change elements attributed to `author` across every word/*.xml
 * story (body + footnotes + comments). This is the ground truth for "the write
 * produced a native OOXML revision element," independent of the write-time
 * emitter's internal bookkeeping.
 */
async function countAiRevisions(doc: DocxDocument, author: string): Promise<number> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  const zip = await DocxZip.load(buffer);
  let count = 0;
  for (const fileName of zip.listFiles()) {
    if (!fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue;
    const xml = await zip.readTextOrNull(fileName);
    if (!xml) continue;
    const parsed = parseXml(xml);
    for (const node of Array.from(parsed.getElementsByTagName('*'))) {
      if (node.namespaceURI !== W_NS || !TRACKED_CHANGE_ELEMENT_NAME_SET.has(node.localName)) continue;
      const attr =
        node.getAttributeNS(W_NS, 'author') ?? node.getAttribute('w:author') ?? node.getAttribute('author');
      if (attr === author) count += 1;
    }
  }
  return count;
}

// The write-time revisionable editors that must emit at least one AI-authored
// tracked-change element per invocation. Delete/update variants operate on
// pre-existing structures and are exercised by the #120/#121 emitter tests; the
// forbid-untracked guarantee here targets the fresh-emission editors.
const REVISIONABLE_EDITORS: Array<{
  name: string;
  run: (mgr: SessionManager, filePath: string, firstParaId: string, paraIds: string[]) => Promise<unknown>;
  bodyXml?: string;
}> = [
  {
    name: 'replace_text',
    run: (mgr, filePath, firstParaId) =>
      replaceText(mgr, {
        file_path: filePath,
        target_paragraph_id: firstParaId,
        old_string: 'bravo',
        new_string: 'BRAVO',
        instruction: 'uppercase bravo',
      }),
  },
  {
    name: 'insert_paragraph',
    run: (mgr, filePath, firstParaId) =>
      insertParagraph(mgr, {
        file_path: filePath,
        positional_anchor_node_id: firstParaId,
        new_string: 'Inserted paragraph',
        instruction: 'add a paragraph',
        position: 'AFTER',
      }),
  },
  {
    name: 'batch_edit',
    run: (mgr, filePath, firstParaId) =>
      batchEdit(mgr, {
        file_path: filePath,
        steps: [
          {
            step_id: 's1',
            operation: 'replace_text',
            target_paragraph_id: firstParaId,
            old_string: 'charlie',
            new_string: 'CHARLIE',
            instruction: 'uppercase charlie',
          },
        ],
      }),
  },
  {
    name: 'format_layout',
    run: (mgr, filePath, firstParaId) =>
      formatLayout(mgr, {
        file_path: filePath,
        paragraph_spacing: { paragraph_ids: [firstParaId], before_twips: 240 },
      }),
  },
  {
    name: 'format_numbering',
    bodyXml:
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      + '<w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>',
    run: (mgr, filePath, firstParaId) =>
      formatNumbering(mgr, {
        file_path: filePath,
        target_paragraph_id: firstParaId,
        remove: true,
      }),
  },
  {
    name: 'format_section',
    bodyXml:
      '<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>'
      + '<w:sectPr><w:pgNumType w:start="2"/></w:sectPr>',
    run: (mgr, filePath) =>
      formatSection(mgr, {
        file_path: filePath,
        section_index: 0,
        page_number_start: 1,
      }),
  },
  {
    name: 'insert_section_break',
    bodyXml:
      '<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>Following paragraph</w:t></w:r></w:p>'
      + '<w:sectPr><w:pgNumType w:start="2"/></w:sectPr>',
    run: (mgr, filePath, firstParaId) =>
      insertSectionBreakTool(mgr, {
        file_path: filePath,
        paragraph_id: firstParaId,
        break_type: 'nextPage',
      }),
  },
  {
    name: 'clear_formatting',
    bodyXml: `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha bravo charlie</w:t></w:r></w:p>`,
    run: (mgr, filePath, firstParaId) =>
      clearFormatting(mgr, { file_path: filePath, paragraph_ids: [firstParaId], clear_bold: true }),
  },
  {
    name: 'add_comment',
    run: (mgr, filePath, firstParaId) =>
      addComment(mgr, {
        file_path: filePath,
        target_paragraph_id: firstParaId,
        anchor_text: 'bravo',
        author: 'Reviewer',
        text: 'a note',
      }),
  },
  {
    name: 'add_footnote',
    run: (mgr, filePath, firstParaId) =>
      addFootnote(mgr, {
        file_path: filePath,
        target_paragraph_id: firstParaId,
        after_text: 'bravo',
        text: 'a footnote',
      }),
  },
];

// Revisionable + destructive tools NOT in REVISIONABLE_EDITORS, with the reason
// each is exempt from the fresh-emission property. Together with the editor set
// this must exhaust the revisionable-destructive surface, so a future tool
// cannot silently escape the forbid-untracked guarantee.
const EXEMPT_REVISIONABLE_DESTRUCTIVE: Record<string, string> = {
  save: 'finalizer, not an editor — emits no new revisions of its own',
  delete_comment: 'operates on an existing comment; covered by dedicated root/reply manifest scenarios',
  update_footnote: 'edits existing note text; emission covered by the #120/#121 emitter tests',
  delete_footnote: 'removes an existing footnote; emission covered by the #120/#121 emitter tests',
};

/**
 * Assert that every occurrence of `insertedText` in the body appears only inside
 * a `w:ins` tracked-change wrapper — i.e. the AI edit introduced no untracked
 * body text. Returns the number of matched text nodes (must be > 0).
 */
async function assertInsertedTextIsTracked(doc: DocxDocument, insertedText: string): Promise<number> {
  const { buffer } = await doc.toBuffer({ cleanBookmarks: false });
  const zip = await DocxZip.load(buffer);
  const documentXmlText = await zip.readText('word/document.xml');
  const parsed = parseXml(documentXmlText);
  let matched = 0;
  for (const t of Array.from(parsed.getElementsByTagName('*'))) {
    if (t.namespaceURI !== W_NS || t.localName !== 't') continue;
    if ((t.textContent ?? '') !== insertedText) continue;
    matched += 1;
    let el: Node | null = t.parentNode;
    let insAncestor = false;
    while (el) {
      const asEl = el as Element;
      if (asEl.namespaceURI === W_NS && asEl.localName === 'ins') insAncestor = true;
      el = el.parentNode;
    }
    expect(insAncestor, `inserted text "${insertedText}" was not wrapped in w:ins`).toBe(true);
  }
  return matched;
}

describe('Forbid untracked AI mutations (#122)', () => {
  registerCleanup();

  test.openspec('every tool declares a contract surface')(
    'Scenario: every tool declares a contract surface',
    async ({ given, when, then }: AllureBddContext) => {
      await given('the MCP tool catalog is loaded', () => undefined);
      await when('each tool is inspected for a surface classification', () => undefined);
      await then('every tool declares revisionable, package-mutation, or internal', () => {
        for (const tool of SAFE_DOCX_MCP_TOOLS) {
          expect(TOOL_SURFACE_INDEX[tool.name], `tool ${tool.name} missing surface`).toBeDefined();
          expect(['revisionable', 'package-mutation', 'internal']).toContain(tool.surface);
        }
        // Tools that also mutate package parts are precisely the comment/footnote
        // dual-surface tools ratified in SUPPORT.md Table B.
        const dual = SAFE_DOCX_MCP_TOOLS.filter((t) => t.emitsNonRevisionChanges).map((t) => t.name).sort();
        expect(dual).toEqual(['add_comment', 'add_footnote', 'delete_comment']);
        for (const name of dual) {
          expect(TOOL_SURFACE_INDEX[name]!.surface).toBe('revisionable');
        }
        // Coverage guard (derived from the catalog, not hand-maintained): every
        // revisionable + destructive tool must be either exercised by the
        // fresh-emission property or explicitly exempted with a reason, so a new
        // tool cannot silently escape the forbid-untracked guarantee.
        const revisionableDestructive = SAFE_DOCX_MCP_TOOLS
          .filter((t) => t.surface === 'revisionable' && !t.annotations.readOnlyHint)
          .map((t) => t.name)
          .sort();
        const accountedFor = [
          ...REVISIONABLE_EDITORS.map((e) => e.name),
          ...Object.keys(EXEMPT_REVISIONABLE_DESTRUCTIVE),
        ].sort();
        expect(accountedFor).toEqual(revisionableDestructive);
      });
    },
  );

  test.openspec('revisionable edit tools emit valid AI tracked changes')(
    'Scenario: revisionable edit tools emit valid AI tracked changes',
    async ({ given, when, then }: AllureBddContext) => {
      for (const editor of REVISIONABLE_EDITORS) {
        const opened = await given(`an AI session for ${editor.name}`, () =>
          openSession([], {
            mgr: aiManager(),
            xml: documentXml(editor.bodyXml ?? `<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
          }),
        );

        const result = await when(`${editor.name} performs an AI write`, () =>
          editor.run(opened.mgr, opened.filePath, opened.firstParaId, opened.paraIds),
        );

        await then(`${editor.name} produced valid AI tracked changes`, async () => {
          assertSuccess(result as { success: boolean }, editor.name);
          const session = await docxSession(opened.mgr, opened.filePath);
          const validation = await session.doc.validateAiRevisions(AI);
          expect(validation.errors, `${editor.name} emitted invalid AI revisions`).toEqual([]);
          const revisions = await countAiRevisions(session.doc, AI);
          expect(revisions, `${editor.name} emitted no AI-authored tracked change`).toBeGreaterThan(0);
        });
      }
    },
  );

  test.openspec('revisionable edits produce no untracked AI body content')(
    'Scenario: revisionable edits produce no untracked AI body content',
    async ({ given, when, then }: AllureBddContext) => {
      // Each text-inserting editor introduces a unique sentinel token; the
      // token must appear only inside a w:ins wrapper afterwards.
      const cases: Array<{ name: string; token: string; run: (o: Awaited<ReturnType<typeof openSession>>) => Promise<unknown> }> = [
        {
          name: 'replace_text',
          token: 'ZULU',
          run: (o) =>
            replaceText(o.mgr, {
              file_path: o.filePath,
              target_paragraph_id: o.firstParaId,
              old_string: 'bravo',
              new_string: 'ZULU',
              instruction: 'replace bravo',
            }),
        },
        {
          name: 'insert_paragraph',
          token: 'YANKEE',
          run: (o) =>
            insertParagraph(o.mgr, {
              file_path: o.filePath,
              positional_anchor_node_id: o.firstParaId,
              new_string: 'YANKEE',
              instruction: 'insert paragraph',
              position: 'AFTER',
            }),
        },
        {
          name: 'batch_edit',
          token: 'XRAY',
          run: (o) =>
            batchEdit(o.mgr, {
              file_path: o.filePath,
              steps: [
                {
                  step_id: 's1',
                  operation: 'replace_text',
                  target_paragraph_id: o.firstParaId,
                  old_string: 'charlie',
                  new_string: 'XRAY',
                  instruction: 'replace charlie',
                },
              ],
            }),
        },
      ];

      for (const c of cases) {
        const opened = await given(`an AI session for ${c.name}`, () =>
          openSession([], {
            mgr: aiManager(),
            xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
          }),
        );

        const result = await when(`${c.name} introduces text under the AI actor`, () => c.run(opened));

        await then(`${c.name}'s inserted text lands only inside w:ins`, async () => {
          assertSuccess(result as { success: boolean }, c.name);
          const session = await docxSession(opened.mgr, opened.filePath);
          const matched = await assertInsertedTextIsTracked(session.doc, c.token);
          expect(matched, `expected ${c.name} to insert "${c.token}"`).toBeGreaterThan(0);
          const validation = await session.doc.validateAiRevisions(AI);
          expect(validation.errors).toEqual([]);
        });
      }
    },
  );

  test.openspec('comment reply mode is package-only with no tracked element')(
    'Scenario: comment reply mode is package-only with no tracked element',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('an AI session with a root comment', async () => {
        const o = await openSession([], {
          mgr: aiManager(),
          xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
        });
        const root = await addComment(o.mgr, {
          file_path: o.filePath,
          target_paragraph_id: o.firstParaId,
          anchor_text: 'bravo',
          author: 'Reviewer',
          text: 'root note',
        });
        assertSuccess(root, 'root comment');
        return { ...o, rootCommentId: root.comment_id as number };
      });

      const before = await docxSession(opened.mgr, opened.filePath);
      const revisionsBeforeReply = await countAiRevisions(before.doc, AI);

      const reply = await when('a threaded reply is added', () =>
        addComment(opened.mgr, {
          file_path: opened.filePath,
          parent_comment_id: opened.rootCommentId,
          author: 'Reviewer',
          text: 'a reply',
        }),
      );

      await then('the reply adds no tracked change and records a package-only manifest entry', async () => {
        assertSuccess(reply, 'reply');
        const session = await docxSession(opened.mgr, opened.filePath);
        const revisionsAfterReply = await countAiRevisions(session.doc, AI);
        expect(revisionsAfterReply, 'reply must not emit a new tracked-change element').toBe(revisionsBeforeReply);
        // The reply's manifest entry names side parts only — never document.xml.
        const replyEntry = session.nonRevisionManifest.find(
          (e) => e.tool === 'add_comment' && !e.parts.includes('word/document.xml'),
        );
        expect(replyEntry, 'expected a package-only reply manifest entry').toBeDefined();
        expect(replyEntry!.parts).toContain('word/commentsExtended.xml');
      });
    },
  );

  test.openspec('comment reply deletion is package-only')(
    'Scenario: comment reply deletion is package-only',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('an AI session with a root comment and a reply', async () => {
        const o = await openSession([], {
          mgr: aiManager(),
          xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
        });
        const root = await addComment(o.mgr, {
          file_path: o.filePath,
          target_paragraph_id: o.firstParaId,
          anchor_text: 'bravo',
          author: 'Reviewer',
          text: 'root note',
        });
        assertSuccess(root, 'root comment');
        const reply = await addComment(o.mgr, {
          file_path: o.filePath,
          parent_comment_id: root.comment_id as number,
          author: 'Reviewer',
          text: 'a reply',
        });
        assertSuccess(reply, 'reply');
        return { ...o, replyId: reply.comment_id as number };
      });

      const result = await when('the reply is deleted', () =>
        deleteComment(opened.mgr, { file_path: opened.filePath, comment_id: opened.replyId }),
      );

      await then('the deletion records a package-only manifest entry without document.xml', async () => {
        assertSuccess(result, 'delete reply');
        const session = await docxSession(opened.mgr, opened.filePath);
        const entry = session.nonRevisionManifest.find(
          (e) => e.tool === 'delete_comment' && e.editRevision === session.editRevision,
        );
        expect(entry, 'expected a delete_comment manifest entry').toBeDefined();
        expect(entry!.parts).not.toContain('word/document.xml');
        expect(entry!.parts).toContain('word/comments.xml');
      });
    },
  );

  test.openspec('comment side-part writes are recorded in the save manifest')(
    'Scenario: comment side-part writes are recorded in the save manifest',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('an AI session with one paragraph', () =>
        openSession([], {
          mgr: aiManager(),
          xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
        }),
      );

      await when('a comment is added', () =>
        addComment(opened.mgr, {
          file_path: opened.filePath,
          target_paragraph_id: opened.firstParaId,
          anchor_text: 'bravo',
          author: 'Reviewer',
          text: 'a note',
        }),
      );

      await then('the save report lists the comment side parts as a non-revision change', async () => {
        const tmpDir = await createTrackedTempDir();
        const outPath = path.join(tmpDir, 'out.docx');
        const result = await save(opened.mgr, {
          file_path: opened.filePath,
          save_to_local_path: outPath,
          save_format: 'clean',
        });
        assertSuccess(result, 'save');
        const manifest = result.non_revision_changes as Array<{ tool: string; parts: string[] }> | undefined;
        expect(manifest, 'expected a non-revision manifest').toBeDefined();
        const entry = manifest!.find((e) => e.tool === 'add_comment');
        expect(entry, 'expected an add_comment manifest entry').toBeDefined();
        expect(entry!.parts).toContain('word/comments.xml');
        // Ensure the artifact actually exists (save succeeded end-to-end).
        await fs.access(outPath);
      });
    },
  );

  test.openspec('footnote part creation is recorded in the save manifest')(
    'Scenario: footnote part creation is recorded in the save manifest',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('an AI session with one paragraph', () =>
        openSession([], {
          mgr: aiManager(),
          xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
        }),
      );

      await when('a footnote is added', () =>
        addFootnote(opened.mgr, {
          file_path: opened.filePath,
          target_paragraph_id: opened.firstParaId,
          after_text: 'bravo',
          text: 'a footnote',
        }),
      );

      await then('the save report lists word/footnotes.xml as a non-revision change', async () => {
        const tmpDir = await createTrackedTempDir();
        const outPath = path.join(tmpDir, 'out.docx');
        const result = await save(opened.mgr, {
          file_path: opened.filePath,
          save_to_local_path: outPath,
          save_format: 'clean',
        });
        assertSuccess(result, 'save');
        const manifest = result.non_revision_changes as Array<{ tool: string; parts: string[] }> | undefined;
        expect(manifest, 'expected a non-revision manifest').toBeDefined();
        const entry = manifest!.find((e) => e.tool === 'add_footnote');
        expect(entry, 'expected an add_footnote manifest entry').toBeDefined();
        expect(entry!.parts).toContain('word/footnotes.xml');
      });
    },
  );

  test.openspec('tracked-only edits report no non-revision changes')(
    'Scenario: tracked-only edits report no non-revision changes',
    async ({ given, when, then }: AllureBddContext) => {
      const opened = await given('an AI session with one paragraph', () =>
        openSession([], {
          mgr: aiManager(),
          xml: documentXml(`<w:p><w:r><w:t>Alpha bravo charlie</w:t></w:r></w:p>`),
        }),
      );

      await when('only a body text edit is performed', () =>
        replaceText(opened.mgr, {
          file_path: opened.filePath,
          target_paragraph_id: opened.firstParaId,
          old_string: 'bravo',
          new_string: 'BRAVO',
          instruction: 'uppercase bravo',
        }),
      );

      await then('the save report contains no non-revision change manifest', async () => {
        const tmpDir = await createTrackedTempDir();
        const outPath = path.join(tmpDir, 'out.docx');
        const result = await save(opened.mgr, {
          file_path: opened.filePath,
          save_to_local_path: outPath,
          save_format: 'clean',
        });
        assertSuccess(result, 'save');
        expect(result.non_revision_changes).toBeUndefined();
      });
    },
  );
});
