import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// Cross-cutting auth coverage: a token that IS present but garbage/malformed, as distinct
// from unauthenticated.integration.test.ts (no token at all). Doesn't need a real patient,
// so unaffected by the current FGA outage on /patient and /user.
const SOME_ID = '000000000000000000000000';
const GARBAGE_TOKEN = 'this-is-not-a-jwt';

describe('API error handling — garbage token', () => {
  test('GET /patient/{id} with a garbage token returns 403', async () => {
    const res = await api.get(`/patient/${SOME_ID}`, { auth: GARBAGE_TOKEN });
    expect(res.status(), `get /patient/${SOME_ID} gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('GET /tasks with a garbage token returns 403', async () => {
    const res = await api.get(`/tasks?userId=${SOME_ID}`, { auth: GARBAGE_TOKEN });
    expect(res.status(), `get /tasks gave ${res.status()}: ${await res.text()}`).toBe(403);
  });

  test('POST /tasks/skip with a garbage token returns 403', async () => {
    const res = await api.post('/tasks/skip', {
      data: { scheduleId: SOME_ID, occurrenceAt: new Date().toISOString(), reason: 'test: garbage token' },
      auth: GARBAGE_TOKEN,
    });
    expect(res.status(), `post /tasks/skip gave ${res.status()}: ${await res.text()}`).toBe(403);
  });
});
