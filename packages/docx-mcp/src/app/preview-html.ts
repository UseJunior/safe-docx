import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _cached: string | null = null;

export function getPreviewHtml(): string {
  if (_cached) return _cached;
  _cached = readFileSync(join(__dirname, 'preview.html'), 'utf-8');
  return _cached;
}
