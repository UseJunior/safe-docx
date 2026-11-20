import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import { compareDocuments_tool } from './compare_documents.js';
import { ok } from './types.js';
import { testAllure } from '../testing/allure-test.js';
import { fileURLToPath } from 'node:url';
const TEST_FEATURE = 'add-runtime-revision-fidelity';
const test = testAllure.epic('Document Editing').withLabels({feature:TEST_FEATURE});


test.openspec('Broken edit preserves active state')('discards a non-reversible preview before session publication', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'fidelity-edit-'));
  const manager = new SessionManager({defaultAiAuthor:'Guard'});
  try {
    const source = await buildSyntheticDocx({paragraphs:['Before']});
    const input = path.join(dir,'input.docx'); await fs.writeFile(input,source);
    const session = await manager.createSession(source,'input.docx',input);
    const doc = session.doc, ids = session.revisionIdState;
    const id = doc.readParagraphs().paragraphs[0]!.id;
    const response = await manager.mutateSession(session,async candidate => {
      const ctx = await getRevisionContextForSession(candidate);
      const check = await preflightAiRevisionMutation(candidate,ctx,preview => {
        // Deliberately broken emitter: changes text without a reversible revision wrapper.
        preview.replaceText({targetParagraphId:id,findText:'Before',replaceText:'After'});
      });
      if (check.blocked) return check.blocked;
      candidate.doc.replaceText({targetParagraphId:id,findText:'Before',replaceText:'After'});
      return ok();
    });
    expect(response).toMatchObject({success:false,error:{code:'REVISION_FIDELITY_VIOLATION'},diagnostics:expect.arrayContaining([expect.objectContaining({side:'reject'})])});
    expect(session.doc).toBe(doc); expect(session.revisionIdState).toBe(ids); expect(session.editRevision).toBe(0);
    expect(session.doc.readParagraphs().paragraphs[0]!.text).toBe('Before');
    expect(await fs.readFile(input)).toEqual(source);
  } finally { await manager.clearAllSessions(); await fs.rm(dir,{recursive:true,force:true}); }
});

test.openspec('Compare refuses before writing output')('preserves structured guard diagnostics and creates no output file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'fidelity-compare-'));
  const manager = new SessionManager();
  try {
    const fixtures = fileURLToPath(new URL('../../../../tests/test_documents/redline/', import.meta.url));
    const original = path.join(fixtures, 'ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
    const revised = path.join(fixtures, 'ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');
    const output = path.join(dir, 'out.docx');
    const response = await compareDocuments_tool(manager,{
      original_file_path: original, revised_file_path: revised, save_to_local_path: output,
    });
    expect(response).toMatchObject({
      success: false,
      error: { code: 'REVISION_FIDELITY_VIOLATION' },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ side: 'reject', part: expect.stringContaining('/footer/') }),
      ]),
    });
    await expect(fs.stat(output)).rejects.toMatchObject({code:'ENOENT'});
  } finally { await manager.clearAllSessions(); await fs.rm(dir,{recursive:true,force:true}); }
}, 180_000);
