import { describe, test, expect } from 'vitest';
import { api } from '../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../helpers';

// A "workflow" from the stage manual maps to a single schedule object — there is
// no separate /workflow endpoint in the OpenAPI spec. KRN-1190 ("linking multiple
// workflows to one experiment") is therefore tested by putting multiple schedule
// objects with the same projectId in the `schedules` array.

describe('KRN-1190 — linking multiple workflows to one experiment', () => {
  test('KRN-1190-001: happy path: two workflows attached to one experiment at once', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1190-test');

    try {
      const workflowA = baseSchedule({ notification: { channels: ['push'], title: 'workflow: A', message: 'A' } }, projectId);
      const workflowB = baseSchedule({ notification: { channels: ['push'], title: 'workflow: B', message: 'B' } }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [workflowA, workflowB] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      const patient = await getRes.json();
      expect(patient.schedules).toHaveLength(2);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  // ---------------------------------------------------------------------------------
  // KNOWN ISSUE — reported to Andres on 2026-09-03, not yet resolved.
  //
  // Task creation for a schedule is not reliable. Across 100 repeated runs of this
  // exact test (same input every time), ~92 succeeded within a few seconds and ~8
  // never produced any tasks within 90 seconds. Ruled out on our side:
  //   - GET /tasks?userId=<unknown id> always returns count 0, so the userId filter
  //     itself is not the problem.
  //   - This test's own timeout is raised below, so a run that "fails" here genuinely
  //     waited the full 90s, it's not our test timing out.
  //
  // Open question for Andres: what determines whether/when a schedule produces a
  // task, and why does that fail in ~8% of cases? Once answered, rewrite this test
  // to match the real mechanism instead of a blind poll.
  // ---------------------------------------------------------------------------------
  test(
    'KRN-1190-002 (KRN-1190-BUG-1): two workflows that overlap (same moment)',
    { timeout: 100_000 }, // the poll below can legitimately take up to 90s
    async () => {
      const projectId = await getFirstProjectId();
      const patientId = await createThrowawayPatient('krane-1190-overlap');
      let lastSeenTaskCount = -1;

      try {
        const sameStart = new Date().toISOString();
        const workflowA = baseSchedule(
          { startOn: { event: 'StartDate', startDatetime: sameStart }, notification: { channels: ['push'], title: 'workflow: A', message: 'A' } },
          projectId,
        );
        const workflowB = baseSchedule(
          { startOn: { event: 'StartDate', startDatetime: sameStart }, notification: { channels: ['push'], title: 'workflow: B', message: 'B' } },
          projectId,
        );

        const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [workflowA, workflowB] } });
        expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}`).toBeTruthy();

        await expect.poll(
          async () => {
            const tasksRes = await api.get(`/tasks?userId=${patientId}`);
            const tasks = await tasksRes.json();
            lastSeenTaskCount = tasks.count;
            return tasks.count;
          },
          {
            message: 'waiting for the background process to create tasks for both overlapping workflows',
            timeout: 90_000,
            interval: 5_000,
          },
        ).toBe(2);
      } finally {
        console.log(`last task count seen for patient ${patientId}: ${lastSeenTaskCount}`);
        const del = await api.delete(`/user/${patientId}`);
        console.log('cleaning up test patient, status:', del.status());
      }
    },
  );
});
