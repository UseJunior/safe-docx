export default [
  {
    q: 'What is Safe DOCX?',
    a: 'Safe DOCX is an open-source MCP server that gives AI systems deterministic, local-first Word document editing. It exposes 23 tools for reading, writing, commenting, formatting, and tracking changes in .docx files — all without sending data to remote servers.',
  },
  {
    q: 'Does it send data to remote servers?',
    a: 'No. All operations run in-process on your machine. Documents never leave your environment, even during AI-driven workflows.',
  },
  {
    q: 'Which AI clients work with Safe DOCX?',
    a: 'Any MCP-compatible client — Claude Desktop, Cursor, Windsurf, VS Code with Copilot, and others. You just add a JSON config block pointing to the server.',
  },
  {
    q: 'What can it actually do to a document?',
    a: 'Read content, search with grep, replace text, insert paragraphs, add and delete comments, manage footnotes, format layouts, accept tracked changes, compare document versions, and more — 23 tools across 7 categories.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. Safe DOCX is MIT-licensed. You can read every line of source, fork it, or vendor it into your own project. No usage metering, no black-box service calls.',
  },
  {
    q: 'Does it need LibreOffice or Microsoft Word installed?',
    a: 'No. Safe DOCX is pure TypeScript with zero native dependencies. It runs anywhere JavaScript runs — Node.js, Cloudflare Workers, Vercel Edge, Lambda, or any V8 isolate.',
  },
  {
    q: 'How do I know it works correctly?',
    a: 'The project publishes trust evidence at safedocx.com/trust — including 992 automated tests, per-package coverage data, and a changelog of every behavioral change. All evidence is regenerated on every CI run.',
  },
  {
    q: 'How do I install it?',
    a: 'The fastest way is npx: run <code>npx -y @usejunior/docx-mcp</code> in your terminal. For permanent installs, add the MCP JSON config to your AI client or install via npm with <code>npm install @usejunior/docx-mcp</code>.',
  },
];
