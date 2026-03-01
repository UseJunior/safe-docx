import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const changelogPath = resolve(__dirname, 'changelog.json');
const data = loadJson(changelogPath);

const releases = (data?.releases ?? []).map((r) => ({
  ...r,
  published_display: formatDate(r.published_at),
}));

export default {
  generated_at_utc: data?.generated_at_utc ?? null,
  releases,
  hasReleases: releases.length > 0,
};
