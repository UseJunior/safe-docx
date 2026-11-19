import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, vi } from 'vitest';
import { buildSyntheticDocx, RevisionFidelityViolation } from '@usejunior/docx-core';
import { compareDocuments } from '@usejunior/docx-compare';
import { SessionManager, getRevisionContextForSession } from '../session/manager.js';
import { preflightAiRevisionMutation } from './ai_revision_guard.js';
import { compareDocuments_tool } from './compare_documents.js';
import { ok } from './types.js';
import { testAllure } from '../testing/allure-test.js';
vi.mock('@usejunior/docx-compare', async importOriginal => {
  const actual = await importOriginal<typeof import('@usejunior/docx-compare')>();
  return {...actual,compareDocuments:vi.fn(actual.compareDocuments)};
});
const TEST_FEATURE = 'add-runtime-revision-fidelity';
const test = testAllure.epic('Document Editing').withLabels({feature:TEST_FEATURE});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

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
    const original = path.join(dir,'original.docx'), revised = path.join(dir,'revised.docx'), output = path.join(dir,'out.docx');
    await fs.writeFile(original,await buildSyntheticDocx({paragraphs:['Before']}));
    await fs.writeFile(revised,await buildSyntheticDocx({paragraphs:['After']}));
    vi.mocked(compareDocuments).mockRejectedValueOnce(new RevisionFidelityViolation([{side:'accept',part:'word/document.xml',location:'$[0]',expected:'After',actual:'lost'}]));
    const response = await compareDocuments_tool(manager,{original_file_path:original,revised_file_path:revised,save_to_local_path:output});
    expect(response).toMatchObject({success:false,error:{code:'REVISION_FIDELITY_VIOLATION'},diagnostics:[expect.objectContaining({side:'accept',part:'word/document.xml'})]});
    await expect(fs.stat(output)).rejects.toMatchObject({code:'ENOENT'});
  } finally { await manager.clearAllSessions(); await fs.rm(dir,{recursive:true,force:true}); }
});
