import { test, expect } from 'vitest';
import { api } from '../../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../../helpers';

// Open question (not tied to a KRN ticket yet): if you call PATCH /user/{userId} with
// a `schedules` array, does that replace the existing list, or does it get merged in?
// Not documented in the Swagger doc — this file figures out the answer on a throwaway
// test patient, and cleans up after itself.

test('PATCH /user/{userId} with schedules: merge or replace?', async () => {
  const projectId = await getFirstProjectId();
  console.log('Study/projectId used:', projectId);

  const patientId = await createThrowawayPatient('schedule-merge-test');
  console.log('Created test patient:', patientId);

  try {
    const scheduleA = baseSchedule({ eventDuration: 15 }, projectId);
    const patchOne = await api.patch(`/user/${patientId}`, { data: { schedules: [scheduleA] } });
    expect(patchOne.ok(), `1st PATCH gave ${patchOne.status()}: ${await patchOne.text()}`).toBeTruthy();

    const afterOne = await api.get(`/patient/${patientId}`);
    expect(afterOne.ok()).toBeTruthy();
    const afterOneBody = await afterOne.json();
    console.log('After 1st PATCH, number of schedules:', afterOneBody.schedules?.length);

    const scheduleB = baseSchedule({ eventDuration: 45 }, projectId);
    const patchTwo = await api.patch(`/user/${patientId}`, { data: { schedules: [scheduleB] } });
    expect(patchTwo.ok(), `2nd PATCH gave ${patchTwo.status()}: ${await patchTwo.text()}`).toBeTruthy();

    const afterTwo = await api.get(`/patient/${patientId}`);
    expect(afterTwo.ok()).toBeTruthy();
    const afterTwoBody = await afterTwo.json();
    const durations = (afterTwoBody.schedules ?? []).map((s: any) => s.eventDuration);
    console.log('After 2nd PATCH, number of schedules:', afterTwoBody.schedules?.length, 'eventDurations:', durations);

    if (durations.length === 1 && durations[0] === 45) {
      console.log('RESULT: REPLACE — the 2nd PATCH replaced the 1st schedule.');
      // Confirmed by Andres (2026-08-27): deliberate behavior, not a bug. The PATCH does a
      // shallow merge on the user object — a field you send along (like `schedules`)
      // gets replaced in its entirety, not merged element by element.
      // Open question: does the management UI itself always send back the full schedules
      // list (read-modify-write), so users don't run this risk in practice?
    } else if (durations.includes(15) && durations.includes(45)) {
      console.log('RESULT: MERGE — both schedules are still there.');
    } else {
      console.log('RESULT: unclear, see the raw data above.');
    }
  } finally {
    const del = await api.delete(`/user/${patientId}`);
    console.log('Cleaning up test patient, status:', del.status());
  }
});
