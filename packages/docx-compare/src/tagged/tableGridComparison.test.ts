import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {expect} from 'vitest';
import {DocxDocument,DocxArchive,parseXml,serializeXml,childElements,getParagraphBookmarkId,getParagraphText} from '@usejunior/docx-core';
import {buildDocxFromBodyXml} from '../testing/ooxml-fixtures.js';
import {testAllure} from '../testing/allure-test.js';
import {compareDocuments} from '../index.js';
import {acceptAllChanges,rejectAllChanges,extractTextWithParagraphs} from './trackChangesAcceptorAst.js';
import {bodyTableFootprint} from './tableTopologyGuard.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test=testAllure.epic('Document Comparison').withLabels({feature:'Table grid comparison'}).conformance(
 ...['17.13.5.33','17.13.5.34','17.13.5.35','17.13.5.36','17.13.5.37'].map(section=>({spec:'ECMA-376',edition:5,part:1,section})),
);
const schema=fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs',import.meta.url));
const xml=async(bytes:Buffer)=>(await DocxArchive.load(bytes)).getDocumentXml();
const columns=(widths:number[])=>widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('');
const table=(widths:number[],text='Alpha',nested='')=>'<w:tbl><w:tblPr><w:tblW w:w="'+widths.reduce((a,b)=>a+b,0)+'" w:type="dxa"/></w:tblPr><w:tblGrid>'+columns(widths)+'</w:tblGrid>'+[0,1].map(row=>'<w:tr>'+widths.map((width,col)=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${row===0&&col===0?nested:''}<w:p><w:r><w:t>${col===0?text:'Column '+col} ${row}</w:t></w:r></w:p></w:tc>`).join('')+'</w:tr>').join('')+'</w:tbl>';
const docx=(body:string)=>buildDocxFromBodyXml(body+'<w:p/>');
async function assertPair(original:Buffer,revised:Buffer,label:string,options:Parameters<typeof compareDocuments>[2]={}) {
 const result=await compareDocuments(original,revised,{author:'John Smith',...options});
 expect(result.unrepresentedChanges).toBeUndefined();
 const output=await xml(result.document);const parsed=parseXml(output);
 const grids=Array.from(parsed.getElementsByTagNameNS(W,'tblGridChange'));
 expect(grids).toHaveLength(1);
 expect(Array.from(grids[0]!.attributes).map(a=>a.localName)).toEqual(['id']);
 expect(parsed.getElementsByTagNameNS(W,'tblPrChange').length).toBeGreaterThan(0);
 expect(parsed.getElementsByTagNameNS(W,'tblPrExChange').length).toBeGreaterThan(0);
 expect(parsed.getElementsByTagNameNS(W,'trPrChange').length).toBeGreaterThan(0);
 for(const [mode,project,source] of [['accept',acceptAllChanges,revised],['reject',rejectAllChanges,original]] as const){
  const expected=project(await xml(source));const native=await DocxDocument.load(result.document);await native[mode==='accept'?'acceptChanges':'rejectChanges']();
  for(const actual of [project(output),await xml((await native.toBuffer()).buffer)]){
   expect(bodyTableFootprint(actual)).toEqual(bodyTableFootprint(expected));
   expect(extractTextWithParagraphs(actual)).toBe(extractTextWithParagraphs(expected));
   expect(parseXml(actual).getElementsByTagNameNS(W,'tblGridChange')).toHaveLength(0);
  }
 }
 const directory=await mkdtemp(join(tmpdir(),'sdx-grid-'));
 try{const file=join(directory,'compared.docx');await writeFile(file,result.document);const check=spawnSync(process.execPath,[schema,file],{encoding:'utf8'});expect(check.status,check.stdout+check.stderr).toBe(0);}finally{await rm(directory,{recursive:true,force:true});}
 if(process.env.SAFE_DOCX_GRID_COMPARISON_ARTIFACTS){const dir=process.env.SAFE_DOCX_GRID_COMPARISON_ARTIFACTS;await mkdir(dir,{recursive:true});for(const [suffix,bytes] of [['original',original],['revised',revised],['redline',result.document]] as const)await writeFile(join(dir,`${label}-${suffix}.docx`),bytes);}
 return {result,parsed};
}
test('column widths and a nearby text edit keep native formatting and content revisions',async()=>{
 const original=await docx(table([3000,3000]));const revised=await docx(table([4000,2000],'Revised'));
 const {result,parsed}=await assertPair(original,revised,'width-text');
 expect(result.stats.insertedTableRows).toBe(0);expect(result.stats.deletedTableRows).toBe(0);
 expect(parsed.getElementsByTagNameNS(W,'tcPrChange')).toHaveLength(4);
 expect(parsed.getElementsByTagNameNS(W,'tblPrExChange')).toHaveLength(2);
 expect(parsed.getElementsByTagNameNS(W,'trPrChange')).toHaveLength(2);
});
test('column insertion and deletion replace changed rows and keep inverse grids',async()=>{
 const before=await docx(table([3000,3000]));const after=await docx(table([3000,3000,3000]));
 for(const [original,revised,label] of [[before,after,'insert'],[after,before,'delete']] as const){const {result}=await assertPair(original,revised,label);expect(result.stats.insertedTableRows).toBe(2);expect(result.stats.deletedTableRows).toBe(2);}
});
test('grid companions exclude aliased row insertion markers from historical row properties',async()=>{
 const rowMarker='<q:ins xmlns:q="'+W+'" q:id="20" q:author="Prior"/>';
 const withPendingRow=(widths:number[])=>table(widths).replace('<w:tr>','<w:tr><w:trPr>'+rowMarker+'</w:trPr>');
 const {parsed}=await assertPair(await docx(withPendingRow([3000,3000])),await docx(withPendingRow([4000,2000])),'aliased-row');
 for(const record of Array.from(parsed.getElementsByTagNameNS(W,'trPrChange'))){
  expect(record.getElementsByTagNameNS(W,'ins')).toHaveLength(0);
  expect(record.getElementsByTagNameNS(W,'del')).toHaveLength(0);
 }
});
test('geometry remains structural when optional formatting is ignored',async()=>{
 await assertPair(await docx(table([3000,3000])),await docx(table([4000,2000])),'ignore-formatting',{ignoreFormatting:true});
});
test('grid companions stay on the changed table and omit dates when requested',async()=>{
 const nested=table([1000],'Nested');const {parsed}=await assertPair(await docx(table([3000,3000],'Alpha',nested)),await docx(table([4000,2000],'Alpha',nested)),'nested',{date:null});
 expect(parsed.getElementsByTagNameNS(W,'tblPrExChange')).toHaveLength(2);
 expect(parsed.getElementsByTagNameNS(W,'trPrChange')).toHaveLength(2);
 for(const name of ['tblPrChange','tblPrExChange','trPrChange','tcPrChange'])for(const record of Array.from(parsed.getElementsByTagNameNS(W,name)))expect(record.hasAttributeNS(W,'date')).toBe(false);
});
async function resizeRealTable(bytes:Buffer,widths:number[]):Promise<Buffer>{
 const zip=await JSZip.loadAsync(bytes);const d=parseXml(await zip.file('word/document.xml')!.async('string'));const t=d.getElementsByTagNameNS(W,'tbl')[1]!;
 const grid=childElements(t).find(n=>n.localName==='tblGrid')!;
 childElements(grid).filter(n=>n.localName==='gridCol').forEach((n,i)=>n.setAttributeNS(W,'w:w',String(widths[i]!)));
 for(const row of childElements(t).filter(n=>n.localName==='tr'))childElements(row).filter(n=>n.localName==='tc').forEach((cell,i)=>{const width=cell.getElementsByTagNameNS(W,'tcW')[0]!;width.setAttributeNS(W,'w:w',String(widths[i]!));});
 const props=childElements(t).find(n=>n.localName==='tblPr')!;const width=props.getElementsByTagNameNS(W,'tblW')[0]!;width.setAttributeNS(W,'w:w',String(widths.reduce((a,b)=>a+b,0)));
 zip.file('word/document.xml',serializeXml(d));return zip.generateAsync({type:'nodebuffer'});
}
async function realDocumentPairs(){
 const document=await DocxDocument.load(await readFile(new URL('../../../../tests/test_documents/open-agreements/mutual-nda.docx',import.meta.url)));
 document.insertParagraphBookmarks('grid1398');const original=(await document.toBuffer({cleanBookmarks:false})).buffer;
 const resized=await resizeRealTable(original,[3660,6410]);
 const anchor=document.getParagraphs().find(p=>getParagraphText(p)==='Purpose')!;expect(anchor).toBeDefined();const id=getParagraphBookmarkId(anchor)!;
 document.insertTableColumn({anchorParagraphId:id,columnIndex:2,widthTwips:1800,rowActions:Array.from({length:7},(_,i)=>({kind:'cell' as const,text:i===0?'Response':'Reviewed'}))});
 // Fit the appended column inside the existing page by resizing its neighbour.
 const added=await resizeRealTable((await document.toBuffer({cleanBookmarks:false})).buffer,[3420,4850,1800]);
 return [[original,resized,'real-width'],[original,added,'real-insert'],[added,original,'real-delete']] as const;
}
test('public Mutual NDA supports real width edits and appended/deleted columns',async()=>{
 for(const [original,revised,label]of await realDocumentPairs())await assertPair(original,revised,label);
},120000);

// Explicit reader opt-in fails if LibreOffice is unavailable. Grid history is
// Word-verified: LibreOffice only votes on resolved row content here.
const readerTest=process.env.SAFE_DOCX_TABLE_TOPOLOGY_READER_REQUIRED==='1'?test:test.skip;
readerTest('LibreOffice resolves real NDA row content for width, insertion and deletion redlines',async()=>{
 const {runLibreOfficeOracle}=await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
 const pairs=await realDocumentPairs();
 const jobs=[];
 for(const [original,revised]of pairs){const redline=(await compareDocuments(original,revised)).document;
  jobs.push({op:'identity' as const,docx:original,saveAs:'odt' as const},{op:'identity' as const,docx:revised,saveAs:'odt' as const},{op:'accept' as const,docx:redline,saveAs:'odt' as const},{op:'reject' as const,docx:redline,saveAs:'odt' as const});
 }
 const states=await runLibreOfficeOracle(jobs);
 const textNamespace='urn:oasis:names:tc:opendocument:xmlns:text:1.0';
 const tableNamespace='urn:oasis:names:tc:opendocument:xmlns:table:1.0';
 const shape=(state:string)=>{const parsed=parseXml(state);return {
  paragraphs:Array.from(parsed.getElementsByTagNameNS(textNamespace,'p')).map(node=>node.textContent),
  tables:Array.from(parsed.getElementsByTagNameNS(tableNamespace,'table')).map(table=>Array.from(table.getElementsByTagNameNS(tableNamespace,'table-row')).map(row=>childElements(row).filter(cell=>cell.namespaceURI===tableNamespace&&['table-cell','covered-table-cell'].includes(cell.localName)).map(cell=>cell.textContent))),
 };};
 pairs.forEach(([, ,label],index)=>{const [original,revised,accepted,rejected]=states.slice(index*4,index*4+4).map(shape);expect(accepted,label+' accept').toEqual(revised);expect(rejected,label+' reject').toEqual(original);});
},600000);
