import { loadGDocsCore } from '../gdocs_loader.js';
import { err, type ToolResponse } from './types.js';

const GDOCS_SUPPORTED_TOOLS = new Set([
  'read_file', 'replace_text', 'insert_paragraph', 'grep', 'save',
  'format_layout', 'get_file_status', 'close_file',
]);

export function checkGDocsSupport(toolName: string): ToolResponse | null {
  if (!GDOCS_SUPPORTED_TOOLS.has(toolName)) {
    return err(
      'UNSUPPORTED_FOR_PROVIDER',
      `'${toolName}' is not supported for Google Docs.`,
      'This tool is only available for DOCX files.',
    );
  }
  return null;
}
