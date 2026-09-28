#!/usr/bin/env node
// Generates docs/api-coverage-report.html from api-call-log.ndjson (every API call the
// test suite actually made, recorded by tests/callLog.ts) plus swagger/openapi.json (the
// full KRANE gateway spec). Independent of the xlsx/SRS traceability report — this one
// answers "how much of the real API surface did the tests exercise", based purely on the
// spec, not on Excel-curated requirement rows. No XML/xlsx/OpenAPI parsing libraries —
// the spec is plain JSON and the call log is one JSON object per line.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CALL_LOG_PATH = path.join(ROOT, 'api-call-log.ndjson');
const SPEC_PATH = path.join(ROOT, 'swagger', 'openapi.json');
const OUT_PATH = path.join(ROOT, '..', 'docs', 'api-coverage-report.html');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function parseCallLog(text) {
  const calls = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      calls.push(JSON.parse(t));
    } catch {
      skipped++; // a truncated/corrupt line from a killed run - skip it, don't crash
    }
  }
  return { calls, skipped };
}

function buildPathRegex(template) {
  // Split on {param} tokens (not per-segment) so a template can carry more than one
  // {param} inside a single segment, which OpenAPI technically allows.
  const pattern = template
    .split(/(\{[^}]+\})/g)
    .map((part, i) => (i % 2 === 1 ? '([^/]+)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}/?$`); // tolerate one trailing slash
}

function loadOperations(spec) {
  const ops = [];
  for (const [pathTemplate, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      const segments = pathTemplate.split('/').filter(Boolean);
      const paramSegments = segments.filter((s) => /^\{.*\}$/.test(s)).length;
      ops.push({
        method: method.toUpperCase(),
        pathTemplate,
        summary: pathItem[method].summary || '',
        regex: buildPathRegex(pathTemplate),
        literalSegments: segments.length - paramSegments,
        paramSegments,
      });
    }
  }
  return ops;
}

function normalizeForMatch(rawPath) {
  const noQuery = String(rawPath || '').split('?')[0];
  return noQuery.length > 1 && noQuery.endsWith('/') ? noQuery.slice(0, -1) : noQuery;
}

function pickMostSpecific(candidates) {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.literalSegments - a.literalSegments || // more literal segments wins, e.g. /user/patient beats /user/{userId}
      a.paramSegments - b.paramSegments || // fewer params wins on remaining ties
      b.pathTemplate.length - a.pathTemplate.length, // longer template as a last, stable tie-break
  );
  if (
    sorted.length > 1 &&
    sorted[0].literalSegments === sorted[1].literalSegments &&
    sorted[0].paramSegments === sorted[1].paramSegments &&
    sorted[0].pathTemplate.length === sorted[1].pathTemplate.length
  ) {
    console.warn(
      `Ambiguous match: "${sorted[0].method} ${sorted[0].pathTemplate}" vs "${sorted[1].method} ${sorted[1].pathTemplate}" - picking the first by spec order.`,
    );
  }
  return sorted[0];
}

function computeCoverage(operations, calls) {
  const byKey = new Map(operations.map((op) => [`${op.method} ${op.pathTemplate}`, { op, matches: [] }]));
  const unmatched = [];
  for (const call of calls) {
    const method = String(call.method || '').toUpperCase();
    const normPath = normalizeForMatch(call.path);
    const candidates = operations.filter((op) => op.method === method && op.regex.test(normPath));
    if (candidates.length === 0) {
      unmatched.push(call);
      continue;
    }
    const winner = pickMostSpecific(candidates);
    byKey.get(`${winner.method} ${winner.pathTemplate}`).matches.push(call);
  }
  return { coverage: [...byKey.values()], unmatched };
}

function groupUnmatched(unmatched) {
  const groups = new Map();
  for (const c of unmatched) {
    const method = String(c.method || '').toUpperCase();
    const normPath = normalizeForMatch(c.path);
    const key = `${method} ${normPath}`;
    if (!groups.has(key)) groups.set(key, { method, path: normPath, count: 0, statuses: new Set(), examples: [] });
    const g = groups.get(key);
    g.count++;
    g.statuses.add(c.status);
    if (g.examples.length < 3 && !g.examples.includes(c.path)) g.examples.push(c.path);
  }
  return [...groups.values()];
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function main() {
  if (!fs.existsSync(SPEC_PATH)) {
    console.error(`Missing ${SPEC_PATH}.`);
    process.exit(1);
  }

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Could not read ${SPEC_PATH}: ${err.message}`);
    console.error(
      'If this is an EUNKNOWN/EBUSY read error, swagger/openapi.json may be a OneDrive ' +
        '"cloud-only" placeholder that has not synced to this machine. Right-click the file ' +
        '(or the swagger/ folder) in File Explorer -> "Always keep on this device" (or open ' +
        'it once in an editor to force a download), then re-run this script.',
    );
    process.exit(1);
  }

  const logText = fs.existsSync(CALL_LOG_PATH) ? fs.readFileSync(CALL_LOG_PATH, 'utf-8') : '';
  const { calls, skipped } = parseCallLog(logText);
  if (skipped > 0) console.warn(`Skipped ${skipped} unparseable line(s) in ${CALL_LOG_PATH}.`);

  const operations = loadOperations(spec);
  const { coverage, unmatched } = computeCoverage(operations, calls);
  const unmatchedGroups = groupUnmatched(unmatched);

  const coveredCount = coverage.filter((r) => r.matches.length > 0).length;
  const percent = operations.length > 0 ? Math.round((coveredCount / operations.length) * 100) : 0;

  const header = {
    date: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || process.env.GIT_COMMIT || 'local (no CI)',
    branch: process.env.GITHUB_REF_NAME || 'local (no CI)',
    runId: process.env.GITHUB_RUN_ID || 'local (no CI)',
    gatewayVersion: process.env.KRANE_GATEWAY_VERSION || 'unknown (set KRANE_GATEWAY_VERSION to fill this in)',
  };

  const coverageRowsHtml = coverage
    .sort((a, b) => a.op.pathTemplate.localeCompare(b.op.pathTemplate) || a.op.method.localeCompare(b.op.method))
    .map(({ op, matches }) => {
      const covered = matches.length > 0;
      const examples = [...new Set(matches.map((m) => m.path))].slice(0, 3);
      return `<tr class="${covered ? 'status-covered' : 'status-uncovered'}">
        <td>${escapeHtml(op.method)}</td>
        <td><code>${escapeHtml(op.pathTemplate)}</code></td>
        <td>${escapeHtml(op.summary)}</td>
        <td>${covered ? 'covered' : 'UNCOVERED'}</td>
        <td>${matches.length}</td>
        <td>${examples.map((e) => `<code>${escapeHtml(e)}</code>`).join('<br>')}</td>
      </tr>`;
    })
    .join('\n');

  const unmatchedRowsHtml = unmatchedGroups.length
    ? unmatchedGroups
        .map(
          (g) => `<tr>
        <td>${escapeHtml(g.method)}</td>
        <td><code>${escapeHtml(g.path)}</code></td>
        <td>${g.count}</td>
        <td>${[...g.statuses].join(', ')}</td>
        <td>${g.examples.map((e) => `<code>${escapeHtml(e)}</code>`).join('<br>')}</td>
      </tr>`,
        )
        .join('\n')
    : '<tr><td colspan="5">None.</td></tr>';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KRANE&trade; Scheduling/Tasks - API Coverage Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; font-size: 0.85rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  code { font-size: 0.85em; }
  .header-table td:first-child { font-weight: 600; width: 12rem; }
  .status-covered { background: #eaffea; }
  .status-uncovered { background: #ffecec; }
  .summary-bar { margin: 1rem 0 2rem; }
  .summary-bar .pct { font-size: 1.5rem; font-weight: 700; }
  .bar-track { background: #eee; border-radius: 4px; height: 1.2rem; width: 100%; max-width: 30rem; overflow: hidden; margin-top: 0.4rem; }
  .bar-fill { background: #2e9e44; height: 100%; }
</style>
</head>
<body>
<h1>KRANE&trade; Scheduling/Tasks &mdash; API Coverage Report</h1>
<table class="header-table">
  <tr><td>Generated at</td><td>${escapeHtml(header.date)}</td></tr>
  <tr><td>Commit SHA</td><td>${escapeHtml(header.commitSha)}</td></tr>
  <tr><td>Branch</td><td>${escapeHtml(header.branch)}</td></tr>
  <tr><td>Run ID</td><td>${escapeHtml(header.runId)}</td></tr>
  <tr><td>Gateway version</td><td>${escapeHtml(header.gatewayVersion)}</td></tr>
</table>

<div class="summary-bar">
  <div class="pct">API Coverage: ${percent}% (${coveredCount}/${operations.length} operations)</div>
  <div class="bar-track"><div class="bar-fill" style="width: ${percent}%"></div></div>
</div>

<h2>Operations</h2>
<table>
  <tr><th>Method</th><th>Path</th><th>Summary</th><th>Status</th><th>Matched calls</th><th>Example paths</th></tr>
  ${coverageRowsHtml}
</table>

<h2>Unmatched calls</h2>
<p>Calls the tests made that didn't match any operation in swagger/openapi.json (typos, retired routes, spec drift).</p>
<table>
  <tr><th>Method</th><th>Path</th><th>Count</th><th>Statuses seen</th><th>Example raw paths</th></tr>
  ${unmatchedRowsHtml}
</table>

</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf-8');
  console.log(`API coverage report written to ${OUT_PATH}`);
  console.log(
    `${coveredCount}/${operations.length} operations covered (${percent}%). ${unmatched.length} unmatched call(s) logged separately.`,
  );
}

main();
