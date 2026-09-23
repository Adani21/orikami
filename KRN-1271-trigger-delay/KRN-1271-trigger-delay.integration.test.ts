import { describe, test, expect } from 'vitest';
import { api } from '../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../helpers';

// KRN-1271 — a delay on the trigger: startOn.configuration.delay =
// { durationUnit: hour|day|week|month|year, delayDuration, hour, minute }. Lives on
// the same EventConfiguration as experimentType/featureId/conditionScript, so it
// combines with any startOn.event, not just ExperimentCompleted (KRN-1227).
//
// Confirmed by Andres (2026-09-09): delayDuration/durationUnit picks the day, and
// hour/minute picks the time on that day (see KRN-1538 and the "MP-02 Create
// project — Workflow setup" KB article). There's no way to speed up/simulate time
// in staging, so "task appears once the delay elapses" is tested below by putting
// the delay's target moment in the past instead of waiting for it live.

describe('KRN-1271 — delay on the trigger', () => {
  test('KRN-1271-001: happy path: a delay is accepted and saved as-is', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1271-test');

    try {
      const schedule = baseSchedule(
        {
          startOn: {
            event: 'StartDate',
            startDatetime: new Date().toISOString(),
            configuration: { delay: { durationUnit: 'day', delayDuration: 1, hour: 9, minute: 0 } },
          },
        },
        projectId,
      );

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      const patient = await getRes.json();
      expect(patient.schedules[0].startOn.configuration.delay).toEqual({ durationUnit: 'day', delayDuration: 1, hour: 9, minute: 0 });
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  // KRN-1271-BUG-3: confirmed 2026-09-14 via manual GET /tasks inspection — PATCH-ing a
  // schedule with startOn.configuration.delay (1 day, hour 9, minute 0) immediately creates
  // a task (state: "Future"), so "0 tasks right away" (this test's original assumption) does
  // not hold. That part looks intentional: the "Future" state likely gates visibility/
  // notification until the task is actually due. The real bug is that the task's
  // occurrenceAt sits within seconds of the schedule's startDatetime instead of ~1 day later
  // at 09:00 as the delay configuration requests — the delay has no effect on when the task
  // is scheduled to fire. Report to Andres. If this test suddenly passes, remove `.fails`
  // and keep the occurrenceAt assertion below as the real check.
  test.fails('KRN-1271-002: known bug: a delayed schedule pre-creates a task, but its occurrenceAt ignores the delay', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1271-nodelay-yet');

    try {
      const startDatetime = new Date().toISOString();
      const schedule = baseSchedule(
        {
          startOn: {
            event: 'StartDate',
            startDatetime,
            configuration: { delay: { durationUnit: 'day', delayDuration: 1, hour: 9, minute: 0 } },
          },
        },
        projectId,
      );

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const tasksRes = await api.get(`/tasks?userId=${patientId}`);
      expect(tasksRes.ok(), `get /tasks gave ${tasksRes.status()}: ${await tasksRes.text()}`).toBeTruthy();
      const tasks = await tasksRes.json();
      expect(tasks.count, 'expected the task to be pre-created immediately, gated by its state rather than absent').toBe(1);

      const occurrenceAt = new Date(tasks.items[0].occurrenceAt).getTime();
      const expectedEarliest = new Date(startDatetime).getTime() + 12 * 60 * 60 * 1000; // the delay should push this to ~09:00 the next day, well over 12h out
      expect(
        occurrenceAt,
        `occurrenceAt (${tasks.items[0].occurrenceAt}) should be ~1 day after startDatetime (${startDatetime}), not right on top of it`,
      ).toBeGreaterThan(expectedEarliest);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  // KRN-1271-BUG-1: confirmed by Andres (2026-09-09) that the missing validation on
  // negative/out-of-range delay values is NOT intentional. No lower/upper bound at all on
  // these fields today — values are accepted (200) and stored verbatim, not clamped. If
  // this test suddenly passes, validation has been added — delete `.fails`.
  test.fails('KRN-1271-004: known bug: negative delayDuration and out-of-range hour/minute should be rejected', async () => {
    const projectId = await getFirstProjectId();
    const patientIdA = await createThrowawayPatient('krane-1271-negative-delay');
    const patientIdB = await createThrowawayPatient('krane-1271-bad-hour');
    const patientIdC = await createThrowawayPatient('krane-1271-extreme-negative');

    try {
      const negativeDelay = { durationUnit: 'day', delayDuration: -1, hour: 9, minute: 0 };
      const negativeDelaySchedule = baseSchedule(
        { startOn: { event: 'StartDate', startDatetime: new Date().toISOString(), configuration: { delay: negativeDelay } } },
        projectId,
      );
      const patchA = await api.patch(`/user/${patientIdA}`, { data: { schedules: [negativeDelaySchedule] } });
      expect(patchA.status(), 'a negative delayDuration should be rejected with a validation error').toBe(400);

      const badHour = { durationUnit: 'hour', delayDuration: 1, hour: 25, minute: 90 };
      const badHourSchedule = baseSchedule(
        { startOn: { event: 'StartDate', startDatetime: new Date().toISOString(), configuration: { delay: badHour } } },
        projectId,
      );
      const patchB = await api.patch(`/user/${patientIdB}`, { data: { schedules: [badHourSchedule] } });
      expect(patchB.status(), 'an out-of-range hour/minute should be rejected with a validation error').toBe(400);

      const extremeNegativeDelay = { durationUnit: 'day', delayDuration: -1000, hour: 9, minute: 0 };
      const extremeNegativeSchedule = baseSchedule(
        { startOn: { event: 'StartDate', startDatetime: new Date().toISOString(), configuration: { delay: extremeNegativeDelay } } },
        projectId,
      );
      const patchC = await api.patch(`/user/${patientIdC}`, { data: { schedules: [extremeNegativeSchedule] } });
      expect(patchC.status(), 'there should be a lower bound: -1000 days should be rejected too').toBe(400);
    } finally {
      await api.delete(`/user/${patientIdA}`);
      await api.delete(`/user/${patientIdB}`);
      await api.delete(`/user/${patientIdC}`);
    }
  });

  // KRN-1271-BUG-2: a delay whose target moment is already in the past (startDatetime
  // backdated so startDatetime + delayDuration falls before now) never produces a task
  // within 90s — confirmed 5/5 across two runs (2026-09-10), not the ~8-10% background-job
  // flakiness seen elsewhere (KRN-1190). Either the background job only fires delays it sees
  // becoming due during a poll (and never catches up on ones already overdue when the
  // schedule is created), or backdating startDatetime is not a valid way to simulate "delay
  // elapsed" as Andres suggested. Report to Andres either way. If this test suddenly passes,
  // delete `.fails`.
  test.fails(
    'KRN-1271-003: a task appears once the delay period has actually elapsed',
    { timeout: 100_000 },
    async () => {
      const projectId = await getFirstProjectId();
      const patientId = await createThrowawayPatient('krane-1271-elapsed-delay');

      try {
        // The delay's target moment (startDatetime + 1 day, at 00:00) is already in
        // the past, so the background job should treat it as elapsed and create the
        // task without a real 1h+ wait.
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const schedule = baseSchedule(
          {
            startOn: {
              event: 'StartDate',
              startDatetime: twoDaysAgo.toISOString(),
              configuration: { delay: { durationUnit: 'day', delayDuration: 1, hour: 0, minute: 0 } },
            },
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
            { timeout: 90_000, message: 'expected a task to appear once the (already-elapsed) delay passed' },
          )
          .toBeGreaterThan(0);
      } finally {
        await api.delete(`/user/${patientId}`);
      }
    },
  );
});
