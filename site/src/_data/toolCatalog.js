export default [
  {
    label: 'Reading & Inspection',
    description: 'Open files, search content, and extract document metadata.',
    tools: [
      'read_file',
      'grep',
      'get_session_status',
      'has_tracked_changes',
      'get_comments',
      'get_footnotes',
      'extract_revisions',
    ],
  },
  {
    label: 'Planning & Batch',
    description: 'Stage multi-step edit plans and apply them atomically.',
    tools: ['init_plan', 'merge_plans', 'apply_plan'],
  },
  {
    label: 'Text Editing',
    description: 'Find-and-replace text or insert new paragraphs.',
    tools: ['replace_text', 'insert_paragraph'],
  },
  {
    label: 'Comments & Footnotes',
    description: 'Add, update, or remove comments and footnotes.',
    tools: [
      'add_comment',
      'delete_comment',
      'add_footnote',
      'update_footnote',
      'delete_footnote',
    ],
  },
  {
    label: 'Layout & Formatting',
    description: 'Apply page layout, margins, and paragraph formatting.',
    tools: ['format_layout'],
  },
  {
    label: 'Tracked Changes',
    description: 'Accept revisions or compare two document versions.',
    tools: ['accept_changes', 'compare_documents'],
  },
  {
    label: 'File Operations',
    description: 'Download, duplicate, or clear the current session.',
    tools: ['download', 'duplicate_document', 'clear_session'],
  },
];
