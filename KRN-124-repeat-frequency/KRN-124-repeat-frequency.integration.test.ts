import { describe, test, expect } from 'vitest';
import { api } from '../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../helpers';

// KRN-124 — herhaalfrequentie: a schedule's `repeat` field controls how often a
// test/questionnaire recurs. Per the OpenAPI spec (ScheduleEntityDTO.repeat), this is one of:
//   - RelativeRepeat: { repeatDuration, durationUnit: hour|day|week|month|year, numberOfRepeats? }
//     — "every N <unit>", optionally capped at a number of repeats.
//   - CalendarRepeat: { interval: week|month, occurrences: WeeklyOccurrence[] | MonthlyOccurrence[] }
//     — WeeklyOccurrence = { type: 'weekly', weekday }, MonthlyOccurrence = { type: 'monthly',
//     dayOfMonth?, weekday?, dayOccurrence? } — i.e. "every Monday" or "every 3rd of the month".
//
// Note: there's no way to speed up/simulate time in staging (confirmed by Andres for KRN-1271),
// so the third test below reuses that ticket's approach — backdating startDatetime so the first
// repeat period has already elapsed — rather than waiting for a real occurrence live.

describe('KRN-124 — repeat frequency', () => {
  test('KRN-124-001: happy path: a RelativeRepeat schedule is accepted and saved as-is', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-124-relative');

    try {
      const repeat = { repeatDuration: 1, durationUnit: 'day', numberOfRepeats: 5 };
      const schedule = baseSchedule({ repeat }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const patient = await getRes.json();
      expect(patient.schedules[0].repeat).toEqual(repeat);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  test('KRN-124-002: happy path: a CalendarRepeat schedule (weekly) is accepted and saved as-is', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-124-calendar');

    try {
      const repeat = { interval: 'week', occurrences: [{ type: 'weekly', weekday: 1 }] };
      const schedule = baseSchedule({ repeat }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const patient = await getRes.json();
      expect(patient.schedules[0].repeat).toEqual(repeat);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  test(
    'KRN-124-003: a second occurrence appears once the first repeat period has elapsed',
    { timeout: 100_000 },
    async () => {
      const projectId = await getFirstProjectId();
      const patientId = await createThrowawayPatient('krane-124-elapsed-repeat');

      try {
        // First occurrence's startDatetime is 2 days ago, repeat is "every 1 day" — so the
        // second occurrence's due moment (1 day after the first) is already in the past too.
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const schedule = baseSchedule(
          {
            startOn: { event: 'StartDate', startDatetime: twoDaysAgo },
            repeat: { repeatDuration: 1, durationUnit: 'day' },
          },
          projectId,
        );

        const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
        expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

        await expect
          .poll(
            async () => {
              const tasksRes = await api.get(`/tasks?userId=${patientId}`);
              expect(tasksRes.ok(), `get /tasks gave ${tasksRes.status()}: ${await tasksRes.text()}`).toBeTruthy();
              return (await tasksRes.json()).count;
            },
            { timeout: 90_000, message: 'expected at least 2 tasks: the first occurrence plus the elapsed repeat' },
          )
          .toBeGreaterThanOrEqual(2);
      } finally {
        await api.delete(`/user/${patientId}`);
      }
    },
  );
});
