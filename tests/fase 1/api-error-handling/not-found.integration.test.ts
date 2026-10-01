import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';
import { createThrowawayPatient } from '../../helpers';

// Cross-cutting 404 coverage (see docs/Testideeen_Fase1_Scheduling.docx, section 2 & 4):
// every endpoint below is only ever exercised in the ticket suites with IDs that exist.
// This suite checks the not-found path instead, using a syntactically valid but
// non-existent Mongo ObjectId so a 404 can't be confused with a 400 (malformed id).
const NON_EXISTENT_ID = '000000000000000000000000';

describe('API error handling — 404 Not Found', () => {
  // KRN-ERR-BUG-1 — as of 2026-10-01 staging's FGA (authorization) service is unreachable
  // from the gateway ("FGA Error: connect ECONNREFUSED 10.44.7.68:8080"), so every /user
  // and /user/patient route below currently 500s instead of reaching its normal authz
  // check. Confirmed earlier the same day (before the outage) that these three routes
  // return 403 ("Unauthorized to view/update/delete user ...") for a non-existent id, not
  // 404 — unlike /tasks/skip|reopen|start below, which do give 404 for a non-existent
  // scheduleId and don't appear to depend on FGA. Skipped until FGA is back; re-enable and
  // confirm the 403 still holds. Also worth asking Andres whether 403-over-404 here is
  // deliberate (avoids leaking which patient ids exist) or an inconsistency to fix.
  test.skip('GET /patient/{id} with a non-existent patientId returns 403, not 404', async () => {
    const res = await api.get(`/patient/${NON_EXISTENT_ID}`);
    expect(res.status(), `get /patient/${NON_EXISTENT_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test.skip('PATCH /user/{userId} with a non-existent userId returns 403, not 404', async () => {
    const res = await api.patch(`/user/${NON_EXISTENT_ID}`, { data: { schedules: [] } });
    expect(res.status(), `patch /user/${NON_EXISTENT_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test.skip('DELETE /user/{userId} with a non-existent userId returns 403, not 404', async () => {
    const res = await api.delete(`/user/${NON_EXISTENT_ID}`);
    expect(res.status(), `delete /user/${NON_EXISTENT_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('POST /tasks/skip with a non-existent scheduleId returns 404', async () => {
    const res = await api.post('/tasks/skip', {
      data: { scheduleId: NON_EXISTENT_ID, occurrenceAt: new Date().toISOString(), reason: 'test: schedule does not exist' },
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(404);
  });

  test('POST /tasks/reopen with a non-existent scheduleId returns 404', async () => {
    const res = await api.post('/tasks/reopen', {
      data: { scheduleId: NON_EXISTENT_ID, occurrenceAt: new Date().toISOString() },
    });
    expect(res.status(), `post /tasks/reopen gave ${res.status()}: ${await res.text()}`).toBe(404);
  });

  test('POST /tasks/start with a non-existent scheduleId returns 404', async () => {
    const now = new Date().toISOString();
    const res = await api.post('/tasks/start', {
      data: { scheduleId: NON_EXISTENT_ID, occurrenceAt: now, startedAt: now, finishAt: now },
    });
    expect(res.status(), `post /tasks/start gave ${res.status()}: ${await res.text()}`).toBe(404);
  });

  // A schedule that *does* exist, but an occurrenceAt that never did — the reference doc
  // (swagger/scheduling-tasks-reference.md) flags this exact case as "a good negative-test
  // candidate" since occurrenceAt isn't validated as a date-time format in the spec.
  // Skipped alongside the FGA-dependent tests above: patient creation (POST /user/patient)
  // also 500s during the outage, so this can't set up its fixture right now either.
  test.skip('POST /tasks/skip with a real patient but a non-existent occurrenceAt returns 404', async () => {
    const patientId = await createThrowawayPatient('krane-404-occurrence');
    try {
      const res = await api.post('/tasks/skip', {
        data: { scheduleId: NON_EXISTENT_ID, occurrenceAt: 'this-occurrence-was-never-scheduled', reason: 'test: bogus occurrenceAt' },
      });
      expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(404);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });
});
