/**
 * Baseline A: WmlComparer via dotnet CLI.
 *
 * Shells out to Docxodus's redline tool to perform document comparison.
 * Requires .NET 8+ and Docxodus to be available.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CompareResult, CompareStats } from '../../index.js';

const execFileAsync = promisify(execFile);

export interface DotnetCliOptions {
  /** Author name for revisions. Default: "Comparison" */
  author?: string;
  /** Path to the redline executable or project. Default: uses global 'dotnet run' */
  redlinePath?: string;
  /** Path to Docxodus repository if using 'dotnet run'. */
  docxodusPath?: string;
  /** Path to dotnet executable. Default: 'dotnet' */
  dotnetPath?: string;
  /** Timeout in milliseconds. Default: 60000 (1 minute) */
  timeout?: number;
}

/**
 * Check if dotnet CLI is available.
 */
export async function isDotnetAvailable(dotnetPath = 'dotnet'): Promise<boolean> {
  try {
    await execFileAsync(dotnetPath, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare two DOCX documents using the dotnet CLI.
 *
 * @param original - Original document as Buffer
 * @param revised - Revised document as Buffer
 * @param options - CLI options
 * @returns Comparison result with track changes
 */
export async function compareWithDotnet(
  original: Buffer,
  revised: Buffer,
  options: DotnetCliOptions = {}
): Promise<CompareResult> {
  const {
    author = 'Comparison',
    redlinePath,
    docxodusPath,
    dotnetPath = 'dotnet',
    timeout = 60000,
  } = options;

  // Create a temporary directory for the comparison
  const tempDir = await mkdtemp(join(tmpdir(), 'docx-compare-'));
  const originalPath = join(tempDir, 'original.docx');
  const revisedPath = join(tempDir, 'revised.docx');
  const outputPath = join(tempDir, 'output.docx');

  try {
    // Write input files
    await writeFile(originalPath, original);
    await writeFile(revisedPath, revised);

    // Determine command to run
    let command: string;
    let args: string[];

    if (redlinePath) {
      // Use specified redline executable
      command = redlinePath;
      args = [originalPath, revisedPath, outputPath, `--author=${author}`];
    } else if (docxodusPath) {
      // Use dotnet run with Docxodus project
      command = dotnetPath;
      args = [
        'run',
        '--project',
        join(docxodusPath, 'tools', 'redline', 'redline.csproj'),
        '--configuration',
        'Release',
        '--no-build',
        '--',
        originalPath,
        revisedPath,
        outputPath,
        `--author=${author}`,
      ];
    } else {
      // Try using global tool or assume redline is in PATH
      command = 'redline';
      args = [originalPath, revisedPath, outputPath, `--author=${author}`];
    }

    // Execute comparison
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Parse revision count from stdout if available
    const revisionMatch = stdout.match(/(\d+) revision\(s\) found/);
    const revisionCount = revisionMatch ? parseInt(revisionMatch[1] ?? '0', 10) : 0;

    // Read output file
    const outputBuffer = await readFile(outputPath);

    // Return result
    // Note: We can't get detailed stats without parsing the output DOCX
    // For now, just return the revision count as insertions
    const stats: CompareStats = {
      insertions: revisionCount,
      deletions: 0, // Would need to parse output to get this
      modifications: 0,
    };

    return {
      document: outputBuffer,
      stats,
      engine: 'wmlcomparer',
    };
  } finally {
    // Clean up temporary files
    try {
      await unlink(originalPath);
      await unlink(revisedPath);
      await unlink(outputPath);
      // Note: Can't rmdir because it might not be empty
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if Docxodus redline tool is available.
 *
 * @param docxodusPath - Path to Docxodus repository
 * @param dotnetPath - Path to dotnet executable
 */
export async function isRedlineAvailable(docxodusPath?: string, dotnetPath = 'dotnet'): Promise<boolean> {
  try {
    if (docxodusPath) {
      // Check if the project file exists
      const projectPath = join(docxodusPath, 'tools', 'redline', 'redline.csproj');
      await readFile(projectPath);
      return await isDotnetAvailable(dotnetPath);
    } else {
      // Try running redline --version
      await execFileAsync('redline', ['--version']);
      return true;
    }
  } catch {
    return false;
  }
}
