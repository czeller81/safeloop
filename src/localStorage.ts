import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

export interface SafeloopStorageOptions {
  baseDir?: string;
  // optional external JSONL event file paths (full paths) to merge into snapshots
  externalEventPaths?: string[];
}

export function resolveSafeloopPath(fileName: string, options: SafeloopStorageOptions = {}): string {
  const baseDir = options.baseDir ?? process.cwd();
  return join(baseDir, '.safeloop', fileName);
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function appendLine(filePath: string, line: string): void {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${line}\n`, 'utf8');
}

export function readLines(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
