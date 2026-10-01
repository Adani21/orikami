import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// Cross-cutting auth coverage (docs/Testideeen_Fase1_Scheduling.docx, section 2): a request
// with no bearer token at all. Confirmed 2026-10-01 that a missing token gives 403
// ("forbidden", plain text) on every route checked here — not the more conventional 401 —
// and it's consistent across routes that depend on FGA (/patient, /user) and ones that
// don't (/tasks/*), so this looks like a deliberate choice in the auth middleware itself
// rather than a side effect of the FGA outage or an inconsistency between routes. Worth
// confirming with Andres whether 403-over-401 here is intentional (e.g. not revealing
// whether a request even reached token checking) — same open question as the 403-not-404
// finding in not-found.integration.test.ts.
const SOME_ID = '000000000000000000000000';

describe('API error handling — missing token returns 403, not 401', () => {
  test('GET /patient/{id} without a token returns 403', async () => {
    const res = await api.get(`/patient/${SOME_ID}`, { auth: false });
    expect(res.status(), `get /patient/${SOME_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('PATCH /user/{userId} without a token returns 403', async () => {
    const res = await api.patch(`/user/${SOME_ID}`, { data: { schedules: [] }, auth: false });
    expect(res.status(), `patch /user/${SOME_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('GET /tasks without a token returns 403', async () => {
    const res = await api.get(`/tasks?userId=${SOME_ID}`, { auth: false });
    expect(res.status(), `get /tasks gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('POST /tasks/skip without a token returns 403', async () => {
    const res = await api.post('/tasks/skip', {
      data: { scheduleId: SOME_ID, occurrenceAt: new Date().toISOString(), reason: 'test: no token' },
      auth: false,
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(403);
  });
});
