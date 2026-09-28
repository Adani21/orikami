import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../../helpers';

// KRN-1227 — a schedule should only produce a task once its experiment completes
// (startOn.event = "ExperimentCompleted"), not immediately.
// Open questions for Andres: valid experimentType/featureId values, which task
// counts as "completed" and how to mark it so via the API, and whether there's a
// delay before the new task appears (like KRN-1190). Until answered, only the "no
// task right away" case is testable — see the skipped test below.

describe('KRN-1227 — trigger a schedule on experiment completion', () => {
  test('KRN-1227-001: an ExperimentCompleted schedule does not create a task right away', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1227-test');

    try {
      const schedule = baseSchedule(
        {
          startOn: {
            event: 'ExperimentCompleted',
            configuration: { experimentType: 'questionnaire' },
          },
        },
        projectId,
      );

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const tasksRes = await api.get(`/tasks?userId=${patientId}`);
      expect(tasksRes.ok(), `get /tasks gave ${tasksRes.status()}: ${await tasksRes.text()}`).toBeTruthy();
      const tasks = await tasksRes.json();
      expect(tasks.count).toBe(0);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  test.skip('KRN-1227-002: a task appears once the referenced experiment is completed', async () => {
    // Blocked on open questions 2 and 3 above — needs Andres to confirm how to mark
    // an experiment/task "completed" via the API before this can be written.
  });
});
