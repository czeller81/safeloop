#!/usr/bin/env node
import { startMonitorServer } from './monitor';

function parsePort(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--port') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for --port');
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }
      return parsed;
    }
    if (value.startsWith('--port=')) {
      const parsed = Number(value.slice('--port='.length));
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${value.slice('--port='.length)}`);
      }
      return parsed;
    }
  }
  return undefined;
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE');
}

async function runMonitor(args: string[]): Promise<void> {
  const port = parsePort(args) ?? 3777;

  try {
    const server = await startMonitorServer({ port });
    const url = `http://127.0.0.1:${server.port}`;
    console.log(`Safeloop live monitor running at ${url}`);
    console.log('Press Ctrl+C to stop.');
    process.on('SIGINT', async () => {
      await server.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    if (isAddressInUse(error)) {
      console.log('Safeloop monitor already running.');
      console.log('');
      console.log('URL:');
      console.log(`http://127.0.0.1:${port}`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'monitor') {
    await runMonitor(process.argv.slice(3));
    return;
  }

  console.log('Safeloop CLI');
  console.log('Usage: safeloop monitor [--port <port>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
