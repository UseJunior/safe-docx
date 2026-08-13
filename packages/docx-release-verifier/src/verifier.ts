import { readFile } from 'node:fs/promises';
import { readIndependentDocx } from './archive.js';
import { minimalityVerdict } from './minimality.js';
import { RELEASE_CERTIFICATE_VERSION, type GateName, type ReleaseCertificate, type ReleaseManifest, type Verdict } from './types.js';

function count(text: string, needle: string): number {
  if (!needle) return 0;
  let at = 0;
  let total = 0;
  while (true) {
    at = text.indexOf(needle, at);
    if (at < 0) return total;
    total += 1;
    at += needle.length;
  }
}

function expectedHash(actual: string, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function expectationVerdict(manifest: ReleaseManifest, accept: string, reject: string): Verdict {
  const failures: string[] = [];
  for (const literal of manifest.literalCounts ?? []) {
    const projection = literal.projection === 'reject' ? reject : accept;
    if (count(projection, literal.text) !== literal.count) failures.push(`Expected ${JSON.stringify(literal.text)} ${literal.count} times.`);
  }
  for (const text of manifest.presentOnlyInAccept ?? []) {
    if (!accept.includes(text) || reject.includes(text)) failures.push(`Expected ${JSON.stringify(text)} only in accept projection.`);
  }
  for (const text of manifest.absentFromAccept ?? []) if (accept.includes(text)) failures.push(`Expected ${JSON.stringify(text)} absent from accept projection.`);
  return failures.length ? { status: 'fail', required: true, reason: failures.join(' ') } : { status: 'pass', required: true };
}

function mutationVerdict(manifest: ReleaseManifest, accept: string, reject: string, original: string, intended: string, hashesUnchanged: boolean): Verdict {
  const control = manifest.mutationControl;
  if (!control) return { status: 'not_run', required: false, reason: 'No mutation control was declared.' };
  const projection = control.projection === 'accept' ? accept : reject;
  const expected = control.expected === 'original' ? original : intended;
  const index = control.index ?? [...expected].findIndex((char) => char.trim().length > 0);
  if (index < 0 || index >= expected.length) return { status: 'fail', required: true, reason: 'Mutation control has no valid expected character.' };
  const mutated = `${expected.slice(0, index)}\uFFFD${expected.slice(index + 1)}`;
  return projection !== mutated && hashesUnchanged
    ? { status: 'pass', required: true, details: { index } }
    : { status: 'fail', required: true, reason: 'Mutation control did not cause inequality or modified an input artifact.' };
}

async function renderVerdict(manifest: ReleaseManifest, trackedSha256: string): Promise<Verdict> {
  const required = manifest.requireRenderer === true;
  if (!manifest.rendererEvidencePath) {
    return { status: 'not_run', required, reason: required ? 'Renderer verifier evidence was not supplied.' : 'Rendered PDF was not required.' };
  }
  try {
    const raw = JSON.parse(await readFile(manifest.rendererEvidencePath, 'utf8')) as Record<string, unknown>;
    if ((raw.status !== 'pass' && raw.status !== 'fail' && raw.status !== 'not_run') || raw.trackedSha256 !== trackedSha256) {
      return { status: 'fail', required, reason: 'Renderer evidence is malformed or bound to different tracked bytes.' };
    }
    const details = {
      evidencePath: manifest.rendererEvidencePath,
      trackedSha256,
      configuredContrastPassed: raw.configuredContrastPassed,
      markupTextMatchesPdf: raw.markupTextMatchesPdf,
    };
    if (raw.status === 'pass' && raw.configuredContrastPassed === true && raw.markupTextMatchesPdf === true) {
      return { status: 'pass', required, details };
    }
    return raw.status === 'not_run'
      ? { status: 'not_run', required, reason: typeof raw.reason === 'string' ? raw.reason : 'Renderer evidence was not run.', details }
      : { status: 'fail', required, reason: typeof raw.reason === 'string' ? raw.reason : 'Renderer verification failed.', details };
  } catch (error) {
    return { status: 'not_run', required, reason: `Renderer evidence could not be read: ${(error as Error).message}` };
  }
}

function humanReviewVerdict(review: ReleaseManifest['humanReview']): Verdict {
  if (!review) return { status: 'not_run', required: false, reason: 'No human review metadata was supplied.' };
  return review.approved
    ? { status: 'pass', required: true, details: { reviewer: review.reviewer, reviewedAt: review.reviewedAt } }
    : { status: 'fail', required: true, reason: 'Human review was not approved.', details: { reviewer: review.reviewer, reviewedAt: review.reviewedAt } };
}

function finalVerdict(gates: Record<GateName, Verdict>): { delivery: Verdict; exitCode: 0 | 1 | 3 } {
  const required = Object.values(gates).filter((gate) => gate.required);
  if (required.some((gate) => gate.status === 'fail')) return { delivery: { status: 'fail', required: true, reason: 'At least one required release gate failed.' }, exitCode: 1 };
  if (required.some((gate) => gate.status === 'not_run')) return { delivery: { status: 'not_run', required: true, reason: 'Required release evidence was not run.' }, exitCode: 3 };
  return { delivery: { status: 'pass', required: true }, exitCode: 0 };
}

/** Verifies completed bytes only; no generator implementation is imported. */
export async function verifyRelease(manifest: ReleaseManifest): Promise<ReleaseCertificate> {
  if (manifest.version !== 1) throw new Error(`Unsupported release manifest version: ${manifest.version}`);
  const [original, intendedClean, tracked] = await Promise.all([
    readIndependentDocx(manifest.originalPath), readIndependentDocx(manifest.intendedCleanPath), readIndependentDocx(manifest.trackedPath, manifest.requireNativeComments),
  ]);
  const hashes = { original: original.hash, intendedClean: intendedClean.hash, tracked: tracked.hash };
  const hashesMatch = expectedHash(hashes.original, manifest.expectedHashes?.original)
    && expectedHash(hashes.intendedClean, manifest.expectedHashes?.intendedClean)
    && expectedHash(hashes.tracked, manifest.expectedHashes?.tracked);
  const semanticPass = original.packageVerdict.status === 'pass' && intendedClean.packageVerdict.status === 'pass' && tracked.packageVerdict.status === 'pass'
    && hashesMatch && tracked.reject.text === original.accept.text && tracked.accept.text === intendedClean.accept.text;
  const semantic: Verdict = semanticPass
    ? { status: 'pass', required: true, details: { originalParagraphs: original.accept.paragraphs.length, intendedCleanParagraphs: intendedClean.accept.paragraphs.length, acceptParagraphs: tracked.accept.paragraphs.length, rejectParagraphs: tracked.reject.paragraphs.length } }
    : { status: 'fail', required: true, reason: 'Finished tracked accept/reject projections or hashes do not exactly match supplied operands.' };
  const afterHashes = { original: original.hash, intendedClean: intendedClean.hash, tracked: tracked.hash };
  const renderer = await renderVerdict(manifest, tracked.hash);
  const gates: Record<GateName, Verdict> = {
    semantic,
    minimality: minimalityVerdict(original.reject.paragraphs, intendedClean.accept.paragraphs, tracked.documentXml),
    package: original.packageVerdict.status === 'pass' && intendedClean.packageVerdict.status === 'pass' && tracked.packageVerdict.status === 'pass'
      ? { status: 'pass', required: true, details: { original: original.packageVerdict.details, intendedClean: intendedClean.packageVerdict.details, tracked: tracked.packageVerdict.details } }
      : { status: 'fail', required: true, reason: 'One or more DOCX packages failed independent archive integrity.' },
    comments: tracked.commentVerdict,
    expectations: expectationVerdict(manifest, tracked.accept.text, tracked.reject.text),
    mutationControl: mutationVerdict(manifest, tracked.accept.text, tracked.reject.text, original.accept.text, intendedClean.accept.text, JSON.stringify(hashes) === JSON.stringify(afterHashes)),
    renderer,
    humanReview: humanReviewVerdict(manifest.humanReview),
  };
  const outcome = finalVerdict(gates);
  return { version: RELEASE_CERTIFICATE_VERSION, manifestVersion: manifest.version, hashes, projections: { original: original.accept, intendedClean: intendedClean.accept, accept: tracked.accept, reject: tracked.reject }, gates, ...outcome };
}
