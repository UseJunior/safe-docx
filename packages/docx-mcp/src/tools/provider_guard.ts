import { loadGDocsCore } from '../gdocs_loader.js';
import { err, type ToolResponse } from './types.js';

const GDOCS_SUPPORTED_TOOLS = new Set([
  'read_file', 'replace_text', 'insert_paragraph', 'grep', 'save',
  'format_layout', 'get_file_status', 'close_file',
]);

const ODF_SUPPORTED_TOOLS = new Set([
  'read_file', 'replace_text', 'grep', 'insert_paragraph', 'save', 'get_file_status', 'close_file',
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

export function checkOdfSupport(toolName: string): ToolResponse | null {
  if (!ODF_SUPPORTED_TOOLS.has(toolName)) {
    return err(
      'UNSUPPORTED_FOR_ODF',
      `'${toolName}' is not supported for ODF (.odt) files.`,
      'Use read_file, replace_text, grep, insert_paragraph, save, get_file_status, or close_file for .odt files.',
    );
  }
  return null;
}
