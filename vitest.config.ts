import { defineConfig } from 'vitest/config';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';

const envPath = path.resolve(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

// Start every run with a clean call log, then hand every worker the same absolute path
// (this module-eval code runs once in the main process, before workers spawn — the same
// mechanism already used above to propagate KRANE_BASE_URL/KRANE_API_TOKEN from .env).
const callLogPath = path.resolve(__dirname, 'api-call-log.ndjson');
try {
  unlinkSync(callLogPath);
} catch {
  // No log from a previous run — fine.
}
process.env.KRANE_API_CALL_LOG = callLogPath;

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    fileParallelism: true,
    // Playwright's default test timeout was 30s; Vitest's default is 5s, too short for
    // tests that make several sequential requests against the live staging gateway.
    // Tests that poll for background task creation still set their own longer timeout.
    testTimeout: 30_000,
  },
});
