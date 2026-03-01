/**
 * Audit a redline .docx for namespace and sectPr issues.
 *
 * Usage: npx tsx packages/docx-core/scripts/audit_redline.ts <path-to-docx>
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { auditXmlNamespaces } from '../src/debug/xmlNamespaceAudit.js';
import { auditSectPr } from '../src/debug/sectPrAudit.js';

async function main(): Promise<void> {
  const docxPath = process.argv[2];
  if (!docxPath) {
    console.error('Usage: npx tsx packages/docx-core/scripts/audit_redline.ts <path-to-docx>');
    process.exit(1);
  }

  const absPath = path.resolve(docxPath);
  const buf = fs.readFileSync(absPath);
  const zip = await JSZip.loadAsync(buf);

  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    console.error('No word/document.xml found in', absPath);
    process.exit(1);
  }

  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string') ?? null;

  // Namespace audit
  console.log('=== Namespace Audit ===');
  const nsResult = auditXmlNamespaces(documentXml);
  console.log('OK:', nsResult.ok);
  console.log('Issues:', nsResult.issueCount);
  console.log('Declared prefixes:', nsResult.declaredPrefixCount);
  console.log('Used prefixes:', nsResult.usedPrefixCount);
  if (nsResult.issues.length > 0) {
    console.log('\nFirst 20 issues:');
    for (const issue of nsResult.issues.slice(0, 20)) {
      console.log(`  [${issue.type}] ${issue.message}`);
      console.log(`    Path: ${issue.path}`);
    }
    if (nsResult.issues.length > 20) {
      console.log(`  ... and ${nsResult.issues.length - 20} more`);
    }
  }

  // SectPr audit
  console.log('\n=== SectPr Audit ===');
  const sectPrResult = auditSectPr(documentXml, relsXml);
  console.log('OK:', sectPrResult.ok);
  console.log('Stats:', JSON.stringify(sectPrResult.stats, null, 2));
  if (sectPrResult.issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of sectPrResult.issues) {
      console.log(`  [${issue.type}] ${issue.message}`);
      console.log(`    Path: ${issue.path}`);
    }
  }

  // Quick element inventory for debugging
  console.log('\n=== Element Inventory ===');
  const tagCounts = new Map<string, number>();
  const tagRegex = /<(w:[a-zA-Z]+)/g;
  let match;
  while ((match = tagRegex.exec(documentXml)) !== null) {
    const tag = match[1]!;
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }

  const interestingTags = [
    'w:footnoteReference', 'w:endnoteReference', 'w:sectPr',
    'w:bookmarkStart', 'w:bookmarkEnd', 'w:ins', 'w:del',
    'w:moveFrom', 'w:moveTo', 'w:fldChar', 'w:instrText',
    'w:br', 'w:lastRenderedPageBreak',
  ];
  for (const tag of interestingTags) {
    const count = tagCounts.get(tag) || 0;
    if (count > 0) {
      console.log(`  ${tag}: ${count}`);
    }
  }

  process.exit(nsResult.ok && sectPrResult.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
