#!/usr/bin/env node
// Runs the JUnit test pass and then always generates both reports (the xlsx/SRS
// traceability report and the OpenAPI-based API coverage report), regardless of whether
// the tests passed. Written as a plain Node script (instead of chaining shell commands
// with `;`/`&&` in package.json) because npm on Windows runs scripts through cmd.exe,
// where `;` doesn't mean "then" like it does in bash.
const { spawnSync } = require('child_process');

const testRun = spawnSync(
  'npx',
  ['vitest', 'run', '--reporter=default', '--reporter=junit', '--outputFile.junit=test-results.xml'],
  { stdio: 'inherit', shell: true },
);

const traceabilityReportRun = spawnSync('node', ['scripts/generate-traceability-report.js'], {
  stdio: 'inherit',
  shell: true,
});

const apiCoverageReportRun = spawnSync('node', ['scripts/generate-api-coverage-report.js'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(traceabilityReportRun.status ?? apiCoverageReportRun.status ?? (testRun.status ?? 1));
