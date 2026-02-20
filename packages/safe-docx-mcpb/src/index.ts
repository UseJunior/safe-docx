import { runServer } from '@usejunior/safedocx';

runServer().catch((err) => {
  console.error('[safe-docx-mcpb] Fatal error:', err);
  process.exit(1);
});
