import path from 'node:path';
import fs from 'node:fs/promises';
import { SessionManager } from '../session/manager.js';
import { err, ok, type ToolResponse } from './types.js';
import { mergeSessionResolutionMetadata, resolveSessionForTool } from './session_resolution.js';
import { enforceWritePathPolicy } from './path_policy.js';
import { checkGDocsSupport } from './provider_guard.js';

/** Output formats the export tool can emit. Extensible: `html`/`text` land in #304/#305. */
const SUPPORTED_FORMATS = ['markdown'] as const;
type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

const EXTENSION_FOR_FORMAT: Record<ExportFormat, string> = {
  markdown: '.md',
};

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

/** Default output path: the source path with its extension swapped for the format's. */
function defaultOutputPath(sourcePath: string, format: ExportFormat): string {
  const parsed = path.parse(sourcePath);
  return path.join(parsed.dir, `${parsed.name}${EXTENSION_FOR_FORMAT[format]}`);
}

/**
 * Export a document to a portable text rendering (Markdown today). Writes the rendering to a
 * file (this tool is NOT read-only) and returns the written path, byte count, and — unless
 * `include_markdown: false` — the rendered content itself.
 *
 * DOCX only. Google Docs (`google_doc_id`) is out of scope for this tool.
 */
export async function exportDocument(
  manager: SessionManager,
  params: {
    file_path?: string;
    session_id?: string;
    google_doc_id?: string;
    format?: string;
    output_path?: string;
    allow_overwrite?: boolean;
    include_markdown?: boolean;
  },
): Promise<ToolResponse> {
  try {
    // DOCX-only guard: reject Google Docs requests explicitly rather than silently degrading.
    if (typeof params.google_doc_id === 'string' && params.google_doc_id.trim().length > 0) {
      return checkGDocsSupport('export')!;
    }

    // Validate the requested format up front with a clear error (mirrors read_file), even
    // though the catalog Zod enum also constrains it.
    const format = (params.format ?? 'markdown').toLowerCase();
    if (!SUPPORTED_FORMATS.includes(format as ExportFormat)) {
      return err(
        'INVALID_FORMAT',
        `Invalid export format: ${params.format}`,
        `Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`,
      );
    }
    const exportFormat = format as ExportFormat;

    const resolved = await resolveSessionForTool(manager, params, { toolName: 'export' });
    if (!resolved.ok) return resolved.response;
    const { session, metadata } = resolved;

    const outputPath = expandPath(
      params.output_path?.trim()
        ? params.output_path
        : defaultOutputPath(session.originalPath, exportFormat),
    );

    // Never let the export clobber the source DOCX (e.g. a stray output_path pointing back
    // at it). The default path always differs by extension, but an explicit one might not.
    if (path.resolve(outputPath) === path.resolve(session.originalPath)) {
      return err(
        'OVERWRITE_BLOCKED',
        `Refusing to overwrite the source document: ${outputPath}`,
        'Choose a different output_path.',
      );
    }

    // Guard against clobbering an existing output file unless explicitly allowed.
    if (!params.allow_overwrite) {
      const exists = await fs
        .access(outputPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        return err(
          'OVERWRITE_BLOCKED',
          `Output file already exists: ${outputPath}`,
          'Set allow_overwrite=true to overwrite, or choose a different output_path.',
        );
      }
    }

    const markdown = await session.doc.toMarkdown();
    const buffer = Buffer.from(markdown, 'utf8');

    const policy = await enforceWritePathPolicy(outputPath);
    if (!policy.ok) return policy.response;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, new Uint8Array(buffer));

    const includeMarkdown = params.include_markdown !== false;
    return ok(
      mergeSessionResolutionMetadata(
        {
          format: exportFormat,
          output_path: manager.normalizePath(outputPath),
          bytes_written: buffer.byteLength,
          ...(includeMarkdown ? { markdown } : {}),
        },
        metadata,
      ),
    );
  } catch (error) {
    return err('EXPORT_FAILED', error instanceof Error ? error.message : String(error));
  }
}
