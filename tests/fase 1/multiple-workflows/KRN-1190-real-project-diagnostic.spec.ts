import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';

// Diagnostic test (2026-09-07) — same overlapping-workflows scenario as
// KRN-1190-BUG-1, but against the "Test Automation Staging" project
// (66e954cd6a3b350013d87f35, experimentType "walking") instead of the generic,
// untitled project our other tests use (62a0639fe722db00135e9caa). That generic
// project turned out to almost never produce tasks via a direct PATCH, while a
// workflow created through the real management UI on this project did work. This
// test checks whether the same two-overlapping-workflows scenario is reliable here,
// to isolate whether KRN-1190-BUG-1 is project-specific or a general issue.
//
// This file deliberately sits outside vitest.config.ts's include pattern
// ('tests/**/*.integration.test.ts') — it targets a real, pre-existing staging
// patient and doesn't clean up after itself, so it must only be run manually
// (e.g. `npx vitest run tests/KRN-1190-real-project-diagnostic`), never as part
// of the normal suite.

const REAL_PROJECT_ID = '66e954cd6a3b350013d87f35'; // "Test Automation Staging"

// Vul hier het patient-ID in van de patiënt die je wil gebruiken (te vinden in de
// URL van de staging-UI: .../patients/<dit-stuk>/edit/). Deze patiënt wordt NIET
// aangemaakt of verwijderd door deze test — die moet je zelf al hebben.
const PATIENT_ID = '6a9ec37536a313099376d47f';

function walkingSchedule(overrides: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    projectId: REAL_PROJECT_ID,
    active: true,
    tenantName: 'orikami',
    timezone: 'Europe/Amsterdam',
    eventDuration: 1217495,
    startOn: { event: 'StartDate', startDatetime: now },
    seriesStartDatetime: now,
    reminders: [],
    action: {
      configuration: { experimentType: 'walking' },
      scheduleAction: 'CreateExperimentTask',
      expireAction: 'ExpireExperimentTask',
      remindAction: 'CheckIfExperimentTaskIsToBeReminded',
    },
    notification: { channels: ['push'] },
    ...overrides,
  };
}

describe('KRN-1190 diagnostic — real project, overlapping workflows', () => {
  test(
    'two overlapping walking workflows on Test Automation Staging',
    { timeout: 100_000 },
    async () => {
      expect(PATIENT_ID, 'vul PATIENT_ID bovenaan dit bestand in voordat je deze test draait').not.toBe('');

      let lastSeenTaskCount = -1;

      const startA = new Date().toISOString();
      const startB = new Date(Date.now() + 5000).toISOString();
      const workflowA = walkingSchedule({ startOn: { event: 'StartDate', startDatetime: startA }, seriesStartDatetime: startA });
      const workflowB = walkingSchedule({ startOn: { event: 'StartDate', startDatetime: startB }, seriesStartDatetime: startB });

      const patchRes = await api.patch(`/user/${PATIENT_ID}`, { data: { schedules: [workflowA, workflowB] } });
      expect(patchRes.ok(), `patch /user/${PATIENT_ID} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      await expect.poll(
        async () => {
          const tasksRes = await api.get(`/tasks?userId=${PATIENT_ID}`);
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

      console.log(`last task count seen for patient ${PATIENT_ID}: ${lastSeenTaskCount}`);
    },
  );
});
