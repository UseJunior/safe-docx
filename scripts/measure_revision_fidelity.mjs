/** Reproducible Node measurement; run after npm run build with a public real DOCX. */
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { compareDocuments } from '@usejunior/docx-compare';
import { DocxArchive, DocxDocument, hash } from '@usejunior/docx-core';
import { SessionManager, getRevisionContextForSession } from '../packages/docx-mcp/dist/session/manager.js';
import { preflightAiRevisionMutation } from '../packages/docx-mcp/dist/tools/ai_revision_guard.js';

const inputPath = process.argv[2];
if (!inputPath) throw Error('Usage: node scripts/measure_revision_fidelity.mjs <real.docx> [iterations=3]');
const iterations = Number(process.argv[3] ?? 3);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10) throw Error('Iterations must be 1..10');
const source = await readFile(inputPath);
const doc = await DocxDocument.load(source); doc.insertParagraphBookmarks('fidelity-benchmark');
const paragraph = doc.readParagraphs().paragraphs[0];
if (!paragraph) throw Error('Fixture needs a nonempty paragraph');
doc.replaceText({targetParagraphId:paragraph.id,findText:paragraph.text,replaceText:paragraph.text+' Runtime benchmark.'});
const intended = (await doc.toBuffer({cleanBookmarks:true})).buffer;
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summarize = (on,off) => ({onMs:median(on),offMs:median(off),deltaMs:median(on)-median(off),percent:100*(median(on)-median(off))/median(off),onSamples:on,offSamples:off});
const compareSamples = {on:[],off:[]};
let outputIdentity;
for (let i=-1;i<iterations;i++) {
  for (const enabled of i%2 === 0 ? [false,true] : [true,false]) {
    const start=performance.now();
    const result=await compareDocuments(source,intended,{author:'Fidelity benchmark',date:new Date('2026-01-01T00:00:00Z'),revisionFidelity:enabled});
    const elapsed=performance.now()-start;
    const identity=hash(await (await DocxArchive.load(result.document)).getDocumentXml());
    outputIdentity ??= identity;
    if(identity!==outputIdentity) throw Error('Guard setting changed comparison output');
    if(i>=0) compareSamples[enabled?'on':'off'].push(elapsed);
  }
}
const manager=new SessionManager({defaultAiAuthor:'Fidelity benchmark'});
const editSamples={on:[],off:[]};
const previous=process.env.SAFE_DOCX_REVISION_FIDELITY;
try {
  const session=await manager.createSession(source,basename(inputPath),resolve(inputPath));
  const ctx=await getRevisionContextForSession(session);
  const id=session.doc.readParagraphs().paragraphs[0].id;
  for(let i=-1;i<iterations;i++) for(const enabled of i%2===0?[false,true]:[true,false]) {
    if(enabled) delete process.env.SAFE_DOCX_REVISION_FIDELITY; else process.env.SAFE_DOCX_REVISION_FIDELITY='0';
    const start=performance.now();
    const result=await preflightAiRevisionMutation(session,ctx,(candidate,revision)=>{
      candidate.insertParagraph({positionalAnchorNodeId:id,relativePosition:'AFTER',newText:'Runtime fidelity benchmark.'},revision);
    });
    const elapsed=performance.now()-start;
    if(result.blocked) throw Error(JSON.stringify(result.blocked));
    if(i>=0) editSamples[enabled?'on':'off'].push(elapsed);
  }
} finally {
  if(previous===undefined) delete process.env.SAFE_DOCX_REVISION_FIDELITY; else process.env.SAFE_DOCX_REVISION_FIDELITY=previous;
  await manager.clearAllSessions();
}
console.log(JSON.stringify({schemaVersion:1,node:process.version,input:basename(inputPath),bytes:source.length,paragraphs:doc.readParagraphs().totalParagraphs,iterations,warmups:1,compare:summarize(compareSamples.on,compareSamples.off),editPreflight:summarize(editSamples.on,editSamples.off)},null,2));
