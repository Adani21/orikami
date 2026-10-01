import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// Cross-cutting 400 coverage (docs/Testideeen_Fase1_Scheduling.docx, section 2): missing
// required fields on the /tasks/* payloads. Deliberately doesn't create a patient — these
// only need to prove the request is rejected before it ever looks up a user/schedule, so
// they're unaffected by the FGA outage that's currently blocking the /user routes.
const SOME_ID = '000000000000000000000000';

describe('API error handling — 400 Bad Request (missing required fields)', () => {
  test('POST /tasks/skip without reason is rejected', async () => {
    const res = await api.post('/tasks/skip', {
      data: { scheduleId: SOME_ID, occurrenceAt: new Date().toISOString() },
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('POST /tasks/skip without scheduleId is rejected', async () => {
    const res = await api.post('/tasks/skip', {
      data: { occurrenceAt: new Date().toISOString(), reason: 'test: missing scheduleId' },
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('POST /tasks/reopen without occurrenceAt is rejected', async () => {
    const res = await api.post('/tasks/reopen', { data: { scheduleId: SOME_ID } });
    expect(res.status(), `post /tasks/reopen gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('POST /tasks/start without finishAt is rejected', async () => {
    const now = new Date().toISOString();
    const res = await api.post('/tasks/start', {
      data: { scheduleId: SOME_ID, occurrenceAt: now, startedAt: now },
    });
    expect(res.status(), `post /tasks/start gave ${res.status()}: ${await res.text()}`).toBe(400);
  });

  test('GET /tasks without the required userId query param is rejected', async () => {
    const res = await api.get('/tasks');
    expect(res.status(), `get /tasks gave ${res.status()}: ${await res.text()}`).toBe(400);
  });
});
