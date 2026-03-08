import { z } from 'zod';

type ToolMeta = {
  ui?: {
    resourceUri: string;
    visibility?: Array<'model' | 'app'>;
  };
};

const SESSION_OR_FILE_FIELDS = {
  session_id: z.string().optional(),
  file_path: z.string().optional(),
};

const GET_DOCUMENT_VIEW_ENTRY = {
  name: 'get_document_view' as const,
  description:
    'Get full document view as structured nodes with styles, formatting, and metadata. Returns DocumentViewNode[] for the interactive preview app. Hidden from LLM — only callable by the preview app.',
  input: z.object({
    ...SESSION_OR_FILE_FIELDS,
  }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  _meta: {
    ui: {
      resourceUri: 'ui://safe-docx/preview',
      visibility: ['app'],
    },
  } satisfies ToolMeta,
};

function toJsonObjectSchema(schema: z.ZodTypeAny, name: string): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);
  if (typeof jsonSchema !== 'object' || Array.isArray(jsonSchema) || jsonSchema === null) {
    throw new Error(`Expected JSON schema object for tool '${name}'.`);
  }
  return jsonSchema as Record<string, unknown>;
}

export const GET_DOCUMENT_VIEW_TOOL = {
  name: GET_DOCUMENT_VIEW_ENTRY.name,
  description: GET_DOCUMENT_VIEW_ENTRY.description,
  inputSchema: toJsonObjectSchema(GET_DOCUMENT_VIEW_ENTRY.input, GET_DOCUMENT_VIEW_ENTRY.name),
  annotations: GET_DOCUMENT_VIEW_ENTRY.annotations,
  _meta: GET_DOCUMENT_VIEW_ENTRY._meta,
};
