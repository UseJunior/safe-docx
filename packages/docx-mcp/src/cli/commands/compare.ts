import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  compareDocuments,
  type CompareOptions,
  type DocumentIntegrityCertificate,
} from '@usejunior/docx-compare';
import { DEFAULT_RECONSTRUCTION_MODE } from '../../tools/comparison_defaults.js';
import {
  projectLlmVerificationCertificate,
  type CertificateFormat,
  type LlmVerificationCertificate,
} from '../certificates/llm_certificate.js';

const SUPPORTED_ENGINES: ReadonlySet<NonNullable<CompareOptions['engine']>> = new Set([
  'auto',
  'atomizer',
]);

export interface CompareCommandArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  engine?: string;
  mode?: string;
  author?: string;
  premergeRuns?: boolean;
  verify?: boolean;
  certificatePath?: string;
  certificateFormat?: string;
}

export interface CompareCommandResult {
  output: string;
  engine: string;
  mode: 'inplace' | 'rebuild';
  mode_requested: 'inplace' | 'rebuild';
  fallback_reason?: string;
  bytes: number;
  stats: unknown;
  verification?: DocumentIntegrityCertificate | LlmVerificationCertificate;
  certificate_path?: string;
  certificate_format?: CertificateFormat;
}

export interface CompareCommandDependencies {
  compare: typeof compareDocuments;
}

const DEFAULT_DEPENDENCIES: CompareCommandDependencies = {
  compare: compareDocuments,
};

async function writeFileAtomically(target: string, contents: Buffer | string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function normalizeEngine(raw: string | undefined): NonNullable<CompareOptions['engine']> {
  const candidate = (raw ?? 'atomizer').trim() as NonNullable<CompareOptions['engine']>;
  if (!SUPPORTED_ENGINES.has(candidate)) {
    throw new Error(`Unsupported engine: ${String(raw)}. Use auto or atomizer.`);
  }
  return candidate;
}

function normalizeMode(raw: string | undefined): 'inplace' | 'rebuild' {
  const candidate = (raw ?? DEFAULT_RECONSTRUCTION_MODE).trim().toLowerCase();
  if (candidate !== 'inplace' && candidate !== 'rebuild') {
    throw new Error(`Unsupported mode: ${String(raw)}. Use inplace or rebuild.`);
  }
  return candidate;
}

function normalizeCertificateFormat(raw: string | undefined): CertificateFormat {
  const candidate = (raw ?? 'full').trim().toLowerCase();
  if (candidate !== 'full' && candidate !== 'llm') {
    throw new Error(`Unsupported certificate format: ${String(raw)}. Use full or llm.`);
  }
  return candidate;
}

function defaultOutputPath(revisedPath: string, engine: string, mode: 'inplace' | 'rebuild'): string {
  return revisedPath.replace(/\.docx$/i, '') + `.REDLINE.${engine}.${mode}.docx`;
}

export async function runCompareCommand(
  args: CompareCommandArgs,
  dependencies: CompareCommandDependencies = DEFAULT_DEPENDENCIES,
): Promise<CompareCommandResult> {
  const engine = normalizeEngine(args.engine);
  const mode = normalizeMode(args.mode);
  const certificateFormat = normalizeCertificateFormat(args.certificateFormat);

  const originalAbs = resolve(args.originalPath);
  const revisedAbs = resolve(args.revisedPath);
  const outputAbs = resolve(args.outputPath ?? defaultOutputPath(revisedAbs, engine, mode));
  const certificateAbs =
    args.certificatePath === undefined ? undefined : resolve(args.certificatePath);
  const verify =
    args.verify === true || certificateAbs !== undefined || args.certificateFormat !== undefined;

  if (certificateAbs === outputAbs) {
    throw new Error('The certificate path must differ from the redline output path.');
  }

  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalAbs),
    readFile(revisedAbs),
  ]);

  const result = await dependencies.compare(originalBuffer, revisedBuffer, {
    engine,
    author: args.author ?? 'Comparison',
    reconstructionMode: mode,
    premergeRuns: args.premergeRuns,
    leanXmlVerifier: verify ? { enabled: true } : undefined,
  });

  const verification = result.documentIntegrity;
  if (verify && verification?.status !== 'passed') {
    const status = verification?.status ?? 'not_run';
    const reason = verification?.reason ?? 'The verifier returned no certificate.';
    throw new Error(`Verified comparison did not pass (${status}): ${reason}`);
  }

  const emittedVerification =
    verification && certificateFormat === 'llm'
      ? projectLlmVerificationCertificate(verification)
      : verification;

  if (certificateAbs && emittedVerification) {
    await writeFileAtomically(certificateAbs, `${JSON.stringify(emittedVerification, null, 2)}\n`);
  }
  await writeFileAtomically(outputAbs, result.document);

  return {
    output: outputAbs,
    engine: result.engine,
    mode: result.reconstructionModeUsed ?? mode,
    mode_requested: mode,
    fallback_reason: result.fallbackReason,
    bytes: result.document.length,
    stats: result.stats,
    verification: emittedVerification,
    certificate_path: certificateAbs,
    ...(emittedVerification === undefined ? {} : { certificate_format: certificateFormat }),
  };
}
