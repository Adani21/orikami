import { appendFileSync } from 'fs';
import path from 'path';

// vitest.config.ts sets this (in the main process, before workers spawn) to an absolute
// path so every worker appends to the exact same file, the same way it already propagates
// KRANE_BASE_URL/KRANE_API_TOKEN from .env. Falls back to a repo-relative guess so this
// module doesn't hard-crash if ever imported outside a vitest run.
const LOG_PATH = process.env.KRANE_API_CALL_LOG ?? path.resolve(process.cwd(), 'api-call-log.ndjson');

export interface RecordedCall {
  method: string;
  path: string;
  status: number;
}

export function recordApiCall(call: RecordedCall): void {
  // A single small write to an append-mode fd is atomic enough at the OS level that
  // concurrent vitest workers/threads writing one NDJSON line each won't interleave or
  // corrupt each other's writes — this is what the cross-worker aggregation relies on
  // instead of in-memory state, which wouldn't be shared across worker processes.
  try {
    appendFileSync(LOG_PATH, JSON.stringify(call) + '\n', 'utf-8');
  } catch {
    // Recording must never break a test run.
  }
}
