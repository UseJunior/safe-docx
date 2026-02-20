#!/usr/bin/env node
import { runServer } from './server.js';

runServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
