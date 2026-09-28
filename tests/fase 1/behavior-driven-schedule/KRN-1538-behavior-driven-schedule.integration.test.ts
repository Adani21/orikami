import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient, createThrowawayPatientWithEmail } from '../../helpers';

// KRN-1538 — a schedule should still deliver its experiment even if a patient logs in
// later (or earlier) than expected (startOn.event = "FirstLogin"), and should not fire
// twice if the same underlying event gets reported twice.
//
// Confirmed by Andres (2026-09-14): "FirstLogin" is raised by `PUT /user/activate`
// (body: ActivateUserModel = { email, tenantName }, LEGACY-tagged, jwt-secured) — that's
// the API-level equivalent of "a patient logs in for the first time" (this endpoint sets
// UserModel.active, per the OpenAPI schema).
//
// conditionScript (management-UI screenshot, "experiment completed (conditional
// scheduling)", 2026-09-14): a JS function named `evaluate(user, results)` returning a
// boolean, e.g. `function evaluate(user, results) { return results[0].correct > 15 }` —
// paired with startOn.event = "ExperimentCompleted" + configuration.experimentType. The
// task only triggers once `evaluate` returns true. This confirms the format/contract, but
// actually verifying the condition gates the task would require reporting an experiment's
// results via the API — same open blocker as KRN-1227's second scenario (no
// experiment/results-reporting endpoint exists in this gateway's OpenAPI spec, confirmed
// by re-searching the live spec on 2026-09-14). So conditionScript below is only tested
// for "accepted/saved as-is" and basic validation, not for actually gating a task.

describe('KRN-1538 — schedule reacts to behavior (first login / experiment completion)', () => {
  test('KRN-1538-001: happy path: a FirstLogin schedule is accepted and saved as-is', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1538-test');

    try {
      const schedule = baseSchedule({ startOn: { event: 'FirstLogin' } }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const patient = await getRes.json();
      expect(patient.schedules[0].startOn.event).toBe('FirstLogin');
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  test('KRN-1538-001: a FirstLogin schedule does not create a task right away', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1538-nolog-yet');

    try {
      const schedule = baseSchedule({ startOn: { event: 'FirstLogin' } }, projectId);

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

  test(
    'KRN-1538-002: a task appears once the patient logs in (activates)',
    { timeout: 100_000 },
    async () => {
      const projectId = await getFirstProjectId();
      const { patientId, email } = await createThrowawayPatientWithEmail('krane-1538-late-login');

      try {
        const schedule = baseSchedule({ startOn: { event: 'FirstLogin' } }, projectId);
        const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
        expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

        const beforeTasks = await api.get(`/tasks?userId=${patientId}`);
        expect((await beforeTasks.json()).count, 'no task before the patient has ever logged in').toBe(0);

        const activateRes = await api.put('/user/activate', { data: { email, tenantName: 'orikami' } });
        expect(activateRes.ok(), `put /user/activate gave ${activateRes.status()}: ${await activateRes.text()}`).toBeTruthy();

        await expect
          .poll(
            async () => {
              const tasksRes = await api.get(`/tasks?userId=${patientId}`);
              expect(tasksRes.ok(), `get /tasks gave ${tasksRes.status()}: ${await tasksRes.text()}`).toBeTruthy();
              return (await tasksRes.json()).count;
            },
            { timeout: 90_000, message: 'expected a task to appear once the patient activated (FirstLogin)' },
          )
          .toBeGreaterThan(0);
      } finally {
        const del = await api.delete(`/user/${patientId}`);
        console.log('cleaning up test patient, status:', del.status());
      }
    },
  );

  test(
    'KRN-1538-003: the same FirstLogin event reported twice does not create two tasks',
    { timeout: 100_000 },
    async () => {
      const projectId = await getFirstProjectId();
      const { patientId, email } = await createThrowawayPatientWithEmail('krane-1538-double-login');

      try {
        const schedule = baseSchedule({ startOn: { event: 'FirstLogin' } }, projectId);
        const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
        expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

        const firstActivate = await api.put('/user/activate', { data: { email, tenantName: 'orikami' } });
        expect(firstActivate.ok(), `first put /user/activate gave ${firstActivate.status()}: ${await firstActivate.text()}`).toBeTruthy();

        await expect
          .poll(
            async () => {
              const tasksRes = await api.get(`/tasks?userId=${patientId}`);
              return (await tasksRes.json()).count;
            },
            { timeout: 90_000, message: 'expected exactly one task after the first activation' },
          )
          .toBe(1);

        // Report the same "user activated" event a second time and make sure it doesn't
        // create a second task for the same FirstLogin schedule.
        const secondActivate = await api.put('/user/activate', { data: { email, tenantName: 'orikami' } });
        expect(secondActivate.status(), 'second activation of an already-active patient').toBeLessThan(500);

        const tasksAfterSecond = await api.get(`/tasks?userId=${patientId}`);
        expect((await tasksAfterSecond.json()).count, 'a repeated FirstLogin event should not create a second task').toBe(1);
      } finally {
        const del = await api.delete(`/user/${patientId}`);
        console.log('cleaning up test patient, status:', del.status());
      }
    },
  );

  test('KRN-1538-004: happy path: a conditionScript on an ExperimentCompleted trigger is accepted and saved as-is', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1538-condition-script');

    try {
      const conditionScript = 'function evaluate(user, results) { return results[0].correct > 15; }';
      const schedule = baseSchedule(
        {
          startOn: {
            event: 'ExperimentCompleted',
            configuration: { experimentType: 'sdmt', conditionScript },
          },
        },
        projectId,
      );

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const patient = await getRes.json();
      expect(patient.schedules[0].startOn.configuration.conditionScript).toBe(conditionScript);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  // KRN-1538-BUG-1: confirmed 2026-09-14 (single clean run, no concurrency involved) — a
  // conditionScript that isn't even syntactically valid JS (unbalanced brackets, no working
  // 'evaluate' function) is accepted (PATCH gave 200) instead of rejected. Same
  // validation-gap pattern as KRN-1271-BUG-1. Unknown what happens downstream when this
  // schedule is actually evaluated (silently never fires? crashes the background job?) —
  // worth asking Andres, since a silently-broken condition is the same "patient never gets
  // a reminder, no error to notice it" risk as KRN-1271-BUG-1. If this test suddenly passes
  // (PATCH rejected with 400), delete `.fails`.
  test.fails('KRN-1538-005: known bug: a conditionScript with a JS syntax error is accepted instead of rejected', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1538-broken-script');

    try {
      const brokenScript = 'function evaluate(user, results) { return results[0.correct > 15';
      const schedule = baseSchedule(
        {
          startOn: {
            event: 'ExperimentCompleted',
            configuration: { experimentType: 'sdmt', conditionScript: brokenScript },
          },
        },
        projectId,
      );

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.status(), 'a syntactically invalid conditionScript should be rejected with a validation error').toBe(400);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });
});
