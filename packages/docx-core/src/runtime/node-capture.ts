/** Node-only oracles and opt-in filesystem schema capture. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './hash.js';
import { setEmittedDocumentXmlCapture } from '../primitives/schema-corpus-capture.js';
setEmittedDocumentXmlCapture(xml => {
  const dir = process.env.SDX_SCHEMA_CORPUS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `document-${hash(xml).slice(0, 16)}.xml`), xml);
});
