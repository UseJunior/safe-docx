import { runServer } from '../../server.js';

export async function runServeCommand(): Promise<void> {
  await runServer();
}
