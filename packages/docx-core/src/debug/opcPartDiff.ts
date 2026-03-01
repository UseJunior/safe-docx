import crypto from 'node:crypto';
import JSZip from 'jszip';

export interface OpcPartManifestEntry {
  name: string;
  sizeBytes: number;
  sha256: string;
  isXmlLike: boolean;
}

export interface OpcPartManifest {
  partCount: number;
  totalBytes: number;
  entries: OpcPartManifestEntry[];
}

export interface OpcPartDiffEntry {
  name: string;
  status: 'same' | 'different' | 'only_in_left' | 'only_in_right';
  left?: OpcPartManifestEntry;
  right?: OpcPartManifestEntry;
}

function isXmlLikePart(name: string): boolean {
  return name.endsWith('.xml') || name.endsWith('.rels');
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function buildOpcManifest(docxBuffer: Buffer): Promise<OpcPartManifest> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const fileNames: string[] = [];

  zip.forEach((relativePath, file) => {
    if (!file.dir) {
      fileNames.push(relativePath);
    }
  });

  fileNames.sort((a, b) => a.localeCompare(b));

  const entries: OpcPartManifestEntry[] = [];
  let totalBytes = 0;

  for (const name of fileNames) {
    const file = zip.file(name);
    if (!file) continue;

    const data = await file.async('nodebuffer');
    totalBytes += data.byteLength;

    entries.push({
      name,
      sizeBytes: data.byteLength,
      sha256: sha256(data),
      isXmlLike: isXmlLikePart(name),
    });
  }

  return {
    partCount: entries.length,
    totalBytes,
    entries,
  };
}

export function diffOpcManifests(left: OpcPartManifest, right: OpcPartManifest): OpcPartDiffEntry[] {
  const leftMap = new Map(left.entries.map((entry) => [entry.name, entry]));
  const rightMap = new Map(right.entries.map((entry) => [entry.name, entry]));

  const names = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
  const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));

  const diffs: OpcPartDiffEntry[] = [];
  for (const name of sorted) {
    const l = leftMap.get(name);
    const r = rightMap.get(name);

    if (l && !r) {
      diffs.push({ name, status: 'only_in_left', left: l });
      continue;
    }
    if (!l && r) {
      diffs.push({ name, status: 'only_in_right', right: r });
      continue;
    }

    if (!l || !r) continue;

    const same = l.sha256 === r.sha256 && l.sizeBytes === r.sizeBytes;
    diffs.push({
      name,
      status: same ? 'same' : 'different',
      left: l,
      right: r,
    });
  }

  return diffs;
}
