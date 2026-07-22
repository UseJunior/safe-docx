import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Opt-in capture of every `word/document.xml` the engine emits, so an
 * external OOXML schema validator can check the whole corpus after a test
 * run. No-op (zero I/O) unless `SDX_SCHEMA_CORPUS_DIR` is set.
 *
 * Files are named by content hash, so repeated emissions of the same XML
 * deduplicate and the corpus stays bounded across a full test run. The
 * consumer is `scripts/check_emitted_document_schema.mjs`, which validates
 * the captured corpus against the vendored Transitional WML schema.
 *
 * Capture sites are the three emission choke points: comparison pipelines
 * (`DocxArchive.setDocumentXml`), primitives saves (`DocxDocument.toBuffer`),
 * and generation (`generateDocx`). Capture failures propagate: when the
 * corpus is requested, a partially written corpus must not validate cleanly.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/214
 */
export function maybeCaptureEmittedDocumentXml(xml: string): void {
  const dir = process.env.SDX_SCHEMA_CORPUS_DIR;
  if (!dir) return;
  const digest = createHash('sha256').update(xml).digest('hex').slice(0, 16);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `document-${digest}.xml`), xml);
}
