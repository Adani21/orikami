import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// docs/Testideeen_Fase1_Scheduling.docx, section 4: "GET /tasks?state=... voor elke state
// uit de enum" — every valid state value from the spec (open, skipped, future, inProgress,
// completed, expired) should be accepted, not just rejected for an invalid one (already
// covered in invalid-values.integration.test.ts). Uses a syntactically valid but
// non-existent userId, so — like the rest of this folder's GET /tasks coverage — this
// doesn't depend on a real patient or on the FGA service that's currently unreachable.
const VALID_BUT_NON_EXISTENT_ID = '000000000000000000000000';
const VALID_STATES = ['open', 'skipped', 'future', 'inProgress', 'completed', 'expired'];

describe('GET /tasks — every valid state value is accepted', () => {
  for (const state of VALID_STATES) {
    test(`state=${state} is accepted`, async () => {
      const res = await api.get(`/tasks?userId=${VALID_BUT_NON_EXISTENT_ID}&state=${state}`);
      expect(res.ok(), `get /tasks?...&state=${state} gave ${res.status()}: ${await res.text()}`).toBeTruthy();
    });
  }
});
