import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// Cross-cutting validation coverage (docs/Testideeen_Fase1_Scheduling.docx, section 2):
// malformed ids and invalid enum values, as distinct from the 404 suite's syntactically
// valid-but-non-existent ids. None of these need a real patient, so — like bad-request.
// integration.test.ts — they're unaffected by the current FGA outage on the /user routes.
const VALID_BUT_NON_EXISTENT_ID = '000000000000000000000000';
const MALFORMED_ID = 'this-is-not-an-object-id';

describe('API error handling — malformed ids and invalid enum values', () => {
  // KRN-ERR-BUG-2 — confirmed 2026-10-01: a malformed (non-ObjectId) scheduleId on
  // /tasks/skip and /tasks/reopen doesn't get validated — it reaches a downstream lookup
  // that blows up, and the gateway returns a bare "502 Bad Gateway" instead of a 400.
  // Asserting the desired 400 here (not 502) so this stays red until it's fixed.
  test('POST /tasks/skip with a malformed scheduleId is rejected with 400, not 502 (BUG)', async () => {
    const res = await api.post('/tasks/skip', {
      data: { scheduleId: MALFORMED_ID, occurrenceAt: new Date().toISOString(), reason: 'test: malformed scheduleId' },
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('POST /tasks/reopen with a malformed scheduleId is rejected with 400, not 502 (BUG)', async () => {
    const res = await api.post('/tasks/reopen', {
      data: { scheduleId: MALFORMED_ID, occurrenceAt: new Date().toISOString() },
    });
    expect(res.status(), `post /tasks/reopen gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  // KRN-ERR-BUG-3 — confirmed 2026-10-01: a malformed scheduleId on /tasks/start doesn't
  // 502 like the two above — it 500s, and the error handler itself then crashes trying to
  // build that response (tsoaErrorHandler.js: "Cannot read properties of undefined (reading
  // 'statusText')"), so the client gets a raw Express/Node stack trace including internal
  // file paths instead of any clean error body. Worth flagging to Andres as more than a
  // status-code nit — a crashing error handler can leak internals on any route it guards.
  test('POST /tasks/start with a malformed scheduleId is rejected with 400, not 500 (BUG)', async () => {
    const now = new Date().toISOString();
    const res = await api.post('/tasks/start', {
      data: { scheduleId: MALFORMED_ID, occurrenceAt: now, startedAt: now, finishAt: now },
    });
    expect(res.status(), `post /tasks/start gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  // KRN-ERR-BUG-2 (same root cause as the skip/reopen case above, on the GET /tasks path).
  test('GET /tasks with a malformed userId is rejected with 400, not 502 (BUG)', async () => {
    const res = await api.get(`/tasks?userId=${MALFORMED_ID}`);
    expect(res.status(), `get /tasks?userId=${MALFORMED_ID} gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('GET /tasks with an invalid state value is rejected', async () => {
    const res = await api.get(`/tasks?userId=${VALID_BUT_NON_EXISTENT_ID}&state=onzin-waarde`);
    expect(res.status(), `get /tasks?...&state=onzin-waarde gave ${res.status()}: ${await res.text()}`).toBe(400);
  });
});
