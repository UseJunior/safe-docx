import { mkdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { convertCommentsToFootnotes } from '@usejunior/docx-core';
import { commandHelp, COMMAND_HELP, topLevelUsage } from './cli-help.js';
import {
  assertDistinctInternalPath,
  EXTERNAL_FILENAME,
  formatCliError,
  parseCommandArgs,
  parseGreenfieldCliArgs,
  parseRenderingFlags,
  wantsHelp,
  warnedInternalPath,
  wordColor,
  wordHighlight,
} from './cli-options.js';
import { compileMarkdoc, validateMarkdocAgainstSource } from './compile.js';
import { lintCreationSource, runCreateCommand } from './create/cli-create.js';
import { runPullCommand } from './create/cli-pull.js';
import { CliUsageError, DocxMarkdocError } from './errors.js';
import { exportEditPairs } from './export.js';
import { compileGreenfieldMarkdoc, type GreenfieldStyleProfile } from './greenfield.js';
import { importDocxToMarkdoc } from './import.js';
import { inspectMarkdocSource } from './inspect.js';
import { requireMarkdoc } from './markdoc.js';
import { writeNewFiles } from './output.js';
import { normalizeAnnotationPresentationProfile } from './presentation.js';
import type { AnnotationPresentationProfile, ValidationIssue } from './types.js';

/** Where the CLI writes; the real entry point passes the process streams. */
export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  debug?: boolean;
};

const PROCESS_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/**
 * Run `docx-markdoc` with `argv` (the arguments after the program name) and
 * return its exit code. `--help` or `-h` on any subcommand prints that
 * command's help and returns 0. Every failure is printed by
 * {@link formatCliError}: a usage error or a validation error as one line per
 * problem, any other exception with its stack. Nothing here exits the process.
 */
export async function runCli(argv: readonly string[], io: CliIo = PROCESS_IO): Promise<number> {
  const [command, ...args] = argv;
  try {
    return await dispatch(command, args, io);
  } catch (error) {
    if (error instanceof CliUsageError && error.command === undefined && command && Object.hasOwn(COMMAND_HELP, command)) {
      error.command = command;
    }
    io.stderr(`${formatCliError(error, io.debug ?? Boolean(process.env.DEBUG))}\n`);
    return 1;
  }
}

async function dispatch(command: string | undefined, args: string[], io: CliIo): Promise<number> {
  const writeWarning = (warning: ValidationIssue): void => {
    io.stderr(`WARNING: ${warning.message}${warning.line === undefined ? '' : ` (line ${warning.line})`}\n`);
  };
  if (command === '--help' || command === '-h') {
    io.stdout(`${topLevelUsage()}\n`);
    return 0;
  }
  if (!command) throw new CliUsageError('No command given.');
  const help = commandHelp(command);
  if (!help) throw new CliUsageError(`Unknown command '${command}'.`);
  if (wantsHelp(args)) {
    io.stdout(`${help}\n`);
    return 0;
  }

  if (command === 'import') {
    const { positional: [sourcePath, anchoredPath, markdocPath] } = parseCommandArgs(
      { command, positionalNames: '<source.docx> <anchored.docx> <document.mdoc>', minPositional: 3, maxPositional: 3 },
      args,
    );
    const result = await importDocxToMarkdoc(await readFile(sourcePath!));
    await writeNewFiles([[anchoredPath!, result.anchoredSource], [markdocPath!, result.markdoc]]);
    // REF fields that stay text cannot be edited around; say which and why (#1260).
    for (const kept of result.crossReferences.keptAsText) {
      io.stderr(`warning XREF_KEPT_AS_TEXT: ${kept.location}: REF field "${kept.instruction}" imported as its cached text (${kept.reason}); compile leaves it untouched and refuses edits that would rewrite it.\n`);
    }
    return 0;
  }

  if (command === 'validate') {
    const parsed = parseCommandArgs(
      { command, positionalNames: '<document.mdoc> [anchored.docx]', minPositional: 1, maxPositional: 2, booleans: ['--create'], values: ['--style-profile'] },
      args,
    );
    const [markdocPath, sourcePath] = parsed.positional;
    if (parsed.booleans.has('--create')) {
      // Creation sources are linted only on request: brownfield validation of
      // every existing file keeps exactly the result it had.
      if (sourcePath) throw new CliUsageError('validate --create takes one Markdoc file; an anchored source applies only to brownfield Markdoc.', command);
      const profilePath = parsed.values.get('--style-profile');
      const result = await lintCreationSource(markdocPath!, profilePath === undefined ? {} : { profilePath });
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (parsed.values.has('--style-profile')) throw new CliUsageError('--style-profile applies only with --create.', command);
    const markdoc = await readFile(markdocPath!, 'utf8');
    const result = sourcePath
      ? await validateMarkdocAgainstSource(await readFile(sourcePath), markdoc, { onWarning: writeWarning })
      : requireMarkdoc(markdoc, { onWarning: writeWarning });
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === 'inspect') {
    const { positional: [sourcePath, ...ids] } = parseCommandArgs(
      { command, positionalNames: '<anchored.docx> [paragraph-id ...]', minPositional: 1, maxPositional: Infinity },
      args,
    );
    const records = await inspectMarkdocSource(await readFile(sourcePath!), { paragraphIds: ids.length ? ids : undefined });
    io.stdout(`${JSON.stringify(records, null, 2)}\n`);
    return 0;
  }

  if (command === 'create') {
    const result = await runCreateCommand(args);
    io.stdout(`${result.summary}\n`);
    return 0;
  }

  if (command === 'pull') {
    // 0: the edited DOCX reads as the build; 2: changes or diagnostics were reported (and, with --apply, written).
    const result = await runPullCommand(args);
    io.stdout(`${result.text}\n`);
    return result.exitCode;
  }

  if (command === 'compile-greenfield') {
    const { templatePath, markdocPath, outputDir, profilePath } = parseGreenfieldCliArgs(args);
    const inputPaths = [templatePath, markdocPath, ...(profilePath ? [profilePath] : [])].map((value) => path.resolve(value));
    const resolvedOutputDir = path.resolve(outputDir);
    const outputPaths = ['clean.docx', 'verification.json'].map((name) => path.resolve(outputDir, name));
    if (inputPaths.includes(resolvedOutputDir) || outputPaths.some((output) => inputPaths.includes(output)) || new Set(inputPaths).size !== inputPaths.length) {
      throw new DocxMarkdocError('GREENFIELD_PATH_COLLISION', 'Every greenfield input and output path must be distinct.');
    }
    const profileSource = profilePath ? await readFile(profilePath) : undefined;
    let styleProfile: GreenfieldStyleProfile | undefined;
    if (profileSource) {
      try {
        styleProfile = JSON.parse(profileSource.toString('utf8')) as GreenfieldStyleProfile;
      } catch (error) {
        throw new DocxMarkdocError('INVALID_STYLE_PROFILE_JSON', `Style profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const result = await compileGreenfieldMarkdoc(
      await readFile(templatePath),
      await readFile(markdocPath, 'utf8'),
      { styleProfile, styleProfileSource: profileSource },
    );
    try {
      await mkdir(outputDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new DocxMarkdocError('GREENFIELD_OUTPUT_EXISTS', `Greenfield output directory already exists: ${outputDir}`);
      throw new DocxMarkdocError('GREENFIELD_OUTPUT_DIRECTORY', `Cannot create greenfield output directory '${outputDir}': ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await writeNewFiles([
        [path.join(outputDir, 'clean.docx'), result.clean],
        [path.join(outputDir, 'verification.json'), `${JSON.stringify(result.certificate, null, 2)}\n`],
      ]);
    } catch (error) {
      await rmdir(outputDir).catch(() => undefined);
      throw error;
    }
    io.stdout(`${JSON.stringify(result.certificate, null, 2)}\n`);
    return 0;
  }

  if (command === 'compile' || command === 'verify') {
    const flags = parseRenderingFlags(args);
    const expected = command === 'compile' ? 3 : 2;
    if (flags.positional.length !== expected) {
      const names = command === 'compile' ? '<anchored.docx> <document.mdoc> <output-dir>' : '<anchored.docx> <document.mdoc>';
      throw new CliUsageError(`${command} takes ${names}; got ${flags.positional.length} argument${flags.positional.length === 1 ? '' : 's'}.`, command);
    }
    const [sourcePath, markdocPath, outputDir] = flags.positional as [string, string, string | undefined];
    if (command === 'verify' && flags.includeInternalComments) {
      throw new CliUsageError('Internal comments can be materialized only by compile with an explicit output path.', command);
    }
    let fileProfile: AnnotationPresentationProfile | undefined;
    if (flags.noteProfilePath) {
      const raw = await readFile(flags.noteProfilePath, 'utf8');
      try {
        fileProfile = JSON.parse(raw) as AnnotationPresentationProfile;
      } catch (error) {
        throw new DocxMarkdocError('INVALID_NOTE_PROFILE_JSON', `Note profile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const overrideProfile = Object.fromEntries(Object.entries(flags.notePresentation).map(([audience, as]) => [audience, { as }])) as AnnotationPresentationProfile;
    const annotationPresentation = normalizeAnnotationPresentationProfile(fileProfile ?? (Object.keys(overrideProfile).length ? overrideProfile : undefined));
    const hasAnnotationProfile = flags.noteProfilePath !== undefined || Object.keys(overrideProfile).length > 0;
    const hasCliOverride = flags.externalComments !== undefined || flags.includeInternalComments || hasAnnotationProfile;
    const result = await compileMarkdoc(await readFile(sourcePath), await readFile(markdocPath, 'utf8'), {
      ...(flags.externalComments === undefined ? {} : { externalComments: flags.externalComments }),
      ...(flags.includeInternalComments ? { dangerouslyIncludeInternalComments: true } : {}),
      ...(hasAnnotationProfile ? { annotationPresentation } : {}),
      ...(hasCliOverride ? { configurationSource: 'cli' } : {}),
    });
    if (command === 'compile') {
      if (!result.certificate.deliveryReady) {
        throw new DocxMarkdocError(
          'DELIVERY_NOT_READY',
          'Projection verification passed, but draft completeness blocks deliverable output.',
          result.certificate,
        );
      }
      await mkdir(outputDir!, { recursive: true });
      const cleanPath = path.join(outputDir!, 'clean.docx');
      const externalPath = path.join(
        outputDir!,
        result.certificate.commentRendering.externalCommentsIncluded
          && !result.certificate.commentRendering.internalCommentsIncluded
          ? EXTERNAL_FILENAME
          : 'redline.docx',
      );
      const internalPath = flags.internalOutput ? warnedInternalPath(flags.internalOutput) : undefined;
      if (internalPath) {
        assertDistinctInternalPath(internalPath, [sourcePath, cleanPath, externalPath]);
        await mkdir(path.dirname(internalPath), { recursive: true });
      }
      await writeNewFiles([
        [cleanPath, result.clean],
        [internalPath ?? externalPath, result.tracked],
        [path.join(outputDir!, 'verification.json'), `${JSON.stringify(result.certificate, null, 2)}\n`],
      ]);
      if (result.certificate.commentRendering.externalCommentsIncluded) {
        io.stderr('WARNING: EXTERNAL COMMENTS INCLUDED in generated redline.\n');
      }
      if (result.certificate.commentRendering.internalCommentsIncluded) {
        io.stderr(`DANGER: INTERNAL COMMENTS INCLUDED in ${internalPath}.\n`);
      }
      for (const warning of result.certificate.commentRendering.warnings) {
        io.stderr(`WARNING: ${warning}\n`);
      }
    }
    for (const warning of result.certificate.markdocWarnings ?? []) writeWarning(warning);
    io.stdout(`${JSON.stringify(result.certificate, null, 2)}\n`);
    return command === 'verify' && !result.certificate.deliveryReady ? 2 : 0;
  }

  if (command === 'export-edits') {
    const { positional: [markdocPath, outputPath] } = parseCommandArgs(
      { command, positionalNames: '<document.mdoc> <output.json>', minPositional: 2, maxPositional: 2 },
      args,
    );
    const ir = requireMarkdoc(await readFile(markdocPath!, 'utf8'), { onWarning: writeWarning });
    await writeNewFiles([[outputPath!, `${JSON.stringify(exportEditPairs(ir), null, 2)}\n`]]);
    return 0;
  }

  if (command === 'comments-to-footnotes') {
    const { positional: [inputPath, outputPath], booleans, values } = parseCommandArgs({
      command,
      positionalNames: '<input.docx> <output.docx>',
      minPositional: 2,
      maxPositional: 2,
      booleans: ['--bold-prefix', '--flatten-threads'],
      values: ['--prefix', '--prefix-separator', '--prefix-color', '--prefix-highlight', '--body-color', '--color', '--body-highlight', '--highlight'],
    }, args);
    const either = (flag: string, alias: string): string | undefined => {
      if (values.has(flag) && values.has(alias)) throw new CliUsageError(`${flag} and ${alias} are the same option; give one.`, command);
      return values.get(flag) ?? values.get(alias);
    };
    const bodyColor = wordColor(either('--body-color', '--color'), values.has('--color') ? '--color' : '--body-color', command);
    const bodyHighlight = wordHighlight(either('--body-highlight', '--highlight'), values.has('--highlight') ? '--highlight' : '--body-highlight', command);
    const prefixColor = wordColor(values.get('--prefix-color'), '--prefix-color', command);
    const prefixHighlight = wordHighlight(values.get('--prefix-highlight'), '--prefix-highlight', command);
    const result = await convertCommentsToFootnotes(await readFile(inputPath!), {
      flattenThreads: booleans.has('--flatten-threads'),
      presentation: {
        prefix: values.get('--prefix'),
        prefixSeparator: values.get('--prefix-separator'),
        prefixStyle: {
          bold: booleans.has('--bold-prefix'),
          color: prefixColor,
          highlight: prefixHighlight,
        },
        bodyStyle: { color: bodyColor, highlight: bodyHighlight },
      },
    });
    await writeNewFiles([[outputPath!, result.buffer]]);
    io.stdout(`${JSON.stringify(result.report, null, 2)}\n`);
    return 0;
  }

  // A command registered in COMMAND_HELP but not handled above is a defect, not a usage error.
  throw new Error(`docx-markdoc: command '${command}' has help but no handler.`);
}

