#!/usr/bin/env node
// Generates docs/traceability-report.html from a Vitest JUnit run (test-results.xml)
// plus docs/traceability-data.json (exported from KRANE-SRS-traceability.xlsx via
// scripts/export-traceability-data.py). No XML/xlsx parsing libraries — the JUnit
// format Vitest emits is simple enough for a small regex-based parser, and the xlsx
// data is pre-exported to JSON so this script has zero new dependencies.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JUNIT_PATH = path.join(ROOT, 'test-results.xml');
const DATA_PATH = path.join(ROOT, '..', 'docs', 'traceability-data.json');
const OUT_PATH = path.join(ROOT, '..', 'docs', 'traceability-report.html');

function parseJUnit(xml) {
  const suiteMatch = xml.match(/<testsuites[^>]*time="([\d.]+)"/);
  const totalDuration = suiteMatch ? parseFloat(suiteMatch[1]) : null;

  const cases = [];
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml))) {
    const attrs = {};
    const attrRe = /(\w[\w-]*)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1]))) attrs[a[1]] = a[2].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const body = m[3] || '';
    const failMatch = body.match(/<(failure|error)\b[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/);
    const skipped = /<skipped\s*\/?>/.test(body);
    cases.push({
      name: attrs.name || '',
      classname: attrs.classname || '',
      time: parseFloat(attrs.time || '0'),
      status: failMatch ? 'failed' : skipped ? 'skipped' : 'passed',
      failureMessage: failMatch ? failMatch[2] : null,
      failureDetail: failMatch ? failMatch[3].trim() : null,
    });
  }
  return { totalDuration, cases };
}

function extractReqIds(testName) {
  // Matches "KRN-1183-001", "KRN-1187-001 & KRN-1187-002", "KRN-1190-002 (KRN-1190-BUG-1)", etc.
  // Ticket numbers vary in length (KRN-124 vs KRN-1538), AC suffix is always 3 digits.
  const matches = testName.match(/KRN-\d+-\d{3}/g);
  return matches ? [...new Set(matches)] : [];
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function main() {
  if (!fs.existsSync(JUNIT_PATH)) {
    console.error(`Missing ${JUNIT_PATH}. Run "npm run test:junit" first.`);
    process.exit(1);
  }
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Missing ${DATA_PATH}. Run "python3 scripts/export-traceability-data.py" first.`);
    process.exit(1);
  }

  const { totalDuration, cases } = parseJUnit(fs.readFileSync(JUNIT_PATH, 'utf-8'));
  const { traceability } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

  // Map each requirement ID to the test case(s) whose name carries that ID tag.
  const casesByReqId = new Map();
  for (const c of cases) {
    for (const reqId of extractReqIds(c.name)) {
      if (!casesByReqId.has(reqId)) casesByReqId.set(reqId, []);
      casesByReqId.get(reqId).push(c);
    }
  }

  const rows = traceability.map((req) => {
    const runCases = casesByReqId.get(req.srsId) || [];
    let liveStatus = 'not run in this pass';
    if (runCases.length > 0) {
      if (runCases.some((c) => c.status === 'failed')) liveStatus = 'failed';
      else if (runCases.every((c) => c.status === 'skipped')) liveStatus = 'skipped';
      else liveStatus = 'passed';
    }
    return { ...req, runCases, liveStatus };
  });

  const passCount = rows.filter((r) => r.liveStatus === 'passed').length;
  const failCount = rows.filter((r) => r.liveStatus === 'failed').length;
  const skipCount = rows.filter((r) => r.liveStatus === 'skipped').length;
  const notRunCount = rows.filter((r) => r.liveStatus === 'not run in this pass').length;

  // Normative coverage overview, grouped by the §81001-5-1 categories actually used in
  // the xlsx (5.7.1 function/edge condition/malformed + 5.7.2 threat), not Bram's
  // original example categories (§A.9 Authn/Authz etc.), which don't correspond to any
  // real requirement here. The §62304 (5.6.x) column/breakdown was dropped per Bram's
  // feedback (2026-09-22) — it didn't add much on top of §81001-5-1.
  function groupBy(keyFn) {
    const groups = new Map();
    for (const r of rows) {
      const key = keyFn(r) || '(unknown)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return groups;
  }
  const by81001 = groupBy((r) => r.iec81001);

  function coverageTableRows(groups) {
    return [...groups.entries()]
      .map(([key, reqs]) => {
        const p = reqs.filter((r) => r.liveStatus === 'passed').length;
        const f = reqs.filter((r) => r.liveStatus === 'failed').length;
        const s = reqs.filter((r) => r.liveStatus === 'skipped').length;
        const n = reqs.filter((r) => r.liveStatus === 'not run in this pass').length;
        return `<tr><td>${escapeHtml(key)}</td><td>${reqs.length}</td><td class="pass">${p}</td><td class="fail">${f}</td><td class="skip">${s}</td><td class="notrun">${n}</td></tr>`;
      })
      .join('\n');
  }

  const header = {
    date: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || process.env.GIT_COMMIT || 'local (no CI)',
    branch: process.env.GITHUB_REF_NAME || 'local (no CI)',
    runId: process.env.GITHUB_RUN_ID || 'local (no CI)',
    gatewayVersion: process.env.KRANE_GATEWAY_VERSION || 'unknown (set KRANE_GATEWAY_VERSION to fill this in)',
    duration: totalDuration != null ? `${totalDuration.toFixed(1)}s` : 'unknown',
  };

  const traceabilityRowsHtml = rows
    .map((r) => {
      const detail = r.runCases
        .filter((c) => c.status === 'failed')
        .map((c) => `<div class="failure-detail"><strong>${escapeHtml(c.name)}</strong>: ${escapeHtml(c.failureMessage)}<pre>${escapeHtml(c.failureDetail)}</pre></div>`)
        .join('');
      return `<tr class="status-${r.liveStatus.replace(/\s+/g, '-')}">
        <td>${escapeHtml(r.srsId)}</td>
        <td>${escapeHtml(r.flow)}</td>
        <td>${escapeHtml(r.requirement)}</td>
        <td>${escapeHtml(r.iec81001)}</td>
        <td>${escapeHtml(r.liveStatus)}</td>
        <td>${escapeHtml(r.lastKnownResult)}</td>
        <td>${detail}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KRANE&trade; Scheduling/Tasks - Traceability Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; font-size: 0.85rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .header-table td:first-child { font-weight: 600; width: 12rem; }
  .status-passed { background: #eaffea; }
  .status-failed { background: #ffecec; }
  .status-skipped, .status-not-run-in-this-pass { background: #fff8e0; }
  td.pass { color: #1a7a1a; }
  td.fail { color: #b30000; }
  td.skip, td.notrun { color: #8a6d00; }
  .failure-detail { margin-top: 0.3rem; font-size: 0.8rem; }
  .failure-detail pre { white-space: pre-wrap; background: #fafafa; padding: 0.3rem; border: 1px solid #eee; }
  .summary { display: flex; gap: 1.5rem; margin: 1rem 0 2rem; }
  .summary div { padding: 0.5rem 1rem; border-radius: 4px; background: #f0f0f0; }
</style>
</head>
<body>
<h1>KRANE&trade; Scheduling/Tasks &mdash; MDR Traceability Report</h1>
<table class="header-table">
  <tr><td>Generated at</td><td>${escapeHtml(header.date)}</td></tr>
  <tr><td>Commit SHA</td><td>${escapeHtml(header.commitSha)}</td></tr>
  <tr><td>Branch</td><td>${escapeHtml(header.branch)}</td></tr>
  <tr><td>Run ID</td><td>${escapeHtml(header.runId)}</td></tr>
  <tr><td>Gateway version</td><td>${escapeHtml(header.gatewayVersion)}</td></tr>
  <tr><td>Duration</td><td>${escapeHtml(header.duration)}</td></tr>
</table>

<h2>Summary (this run)</h2>
<div class="summary">
  <div>Passed: <strong>${passCount}</strong></div>
  <div>Failed: <strong>${failCount}</strong></div>
  <div>Skipped: <strong>${skipCount}</strong></div>
  <div>Not run: <strong>${notRunCount}</strong></div>
  <div>Total requirements: <strong>${rows.length}</strong></div>
</div>

<h2>Normative coverage &mdash; IEC 81001-5-1 &sect;5.7.x</h2>
<table>
  <tr><th>&sect;81001-5-1 category</th><th>Requirements</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Not run</th></tr>
  ${coverageTableRows(by81001)}
</table>

<h2>Traceability &mdash; per requirement</h2>
<table>
  <tr>
    <th>Requirement ID</th><th>Flow</th><th>Requirement</th><th>&sect;81001-5-1</th>
    <th>Result (this run)</th><th>Last known result</th><th>Failure detail (if failed)</th>
  </tr>
  ${traceabilityRowsHtml}
</table>

</body>
</html>
`;

  fs.writeFileSync(OUT_PATH, html, 'utf-8');
  console.log(`Traceability report written to ${OUT_PATH}`);
  console.log(`${passCount} passed, ${failCount} failed, ${skipCount} skipped, ${notRunCount} not run (of ${rows.length} requirements).`);
}

main();
