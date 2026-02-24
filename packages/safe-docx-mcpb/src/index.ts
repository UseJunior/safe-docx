import { runServer } from '@usejunior/docx-mcp';

runServer().catch((err) => {
  console.error('[safe-docx-mcpb] Fatal error:', err);
  process.exit(1);
});
