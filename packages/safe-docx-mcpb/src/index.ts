import { runServer } from '@usejunior/safe-docx';

runServer().catch((err) => {
  console.error('[safe-docx-mcpb] Fatal error:', err);
  process.exit(1);
});
