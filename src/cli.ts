#!/usr/bin/env node
import { startMonitorServer } from './monitor';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'monitor') {
    const server = await startMonitorServer();
    console.log(`Safeloop live monitor running at http://localhost:${server.port}`);
    console.log('Press Ctrl+C to stop.');
    process.on('SIGINT', async () => {
      await server.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await server.close();
      process.exit(0);
    });
    return;
  }

  console.log('Safeloop CLI');
  console.log('Usage: safeloop monitor');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
