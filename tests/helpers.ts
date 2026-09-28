import { expect } from 'vitest';
import { api } from './apiClient';

export function baseSchedule(overrides: Record<string, unknown>, projectId: string) {
  return {
    projectId,
    active: true,
    tenantName: 'orikami',
    timezone: 'Europe/Amsterdam',
    eventDuration: 30,
    startOn: { event: 'StartDate', startDatetime: new Date().toISOString() },
    reminders: [],
    action: {
      configuration: { experimentType: 'questionnaire' },
      scheduleAction: 'CreateExperimentTask',
      expireAction: 'ExpireExperimentTask',
      remindAction: 'CheckIfExperimentTaskIsToBeReminded',
    },
    notification: { channels: ['push'], title: 'Test', message: 'Test' },
    ...overrides,
  };
}

export async function getFirstProjectId(): Promise<string> {
  const studies = await api.get('/study');
  expect(studies.ok(), `get /study gave ${studies.status()}: ${await studies.text()}`).toBeTruthy();
  const studyList = await studies.json();
  return (Array.isArray(studyList) ? studyList : studyList.data)[0]._id;
}

export async function createThrowawayPatient(emailPrefix: string): Promise<string> {
  const { patientId } = await createThrowawayPatientWithEmail(emailPrefix);
  return patientId;
}

export async function createThrowawayPatientWithEmail(
  emailPrefix: string,
): Promise<{ patientId: string; email: string }> {
  const email = `${emailPrefix}-${Date.now()}@orikami-test.invalid`;
  const createRes = await api.post('/user/patient', {
    data: { email, firstname: 'jan', lastname: 'gulden', caregiverIds: [] },
  });
  expect(createRes.ok(), `post /user/patient gave ${createRes.status()}: ${await createRes.text()}`).toBeTruthy();
  const created = await createRes.json();
  const patientId = created._id ?? created.id ?? created.patientId;
  return { patientId, email };
}

export async function getPatientTasks(patientId: string, state?: string): Promise<any> {
  const query = state ? `&state=${state}` : '';
  const res = await api.get(`/tasks?userId=${patientId}${query}`);
  expect(res.ok(), `get /tasks?userId=${patientId}${query} gave ${res.status()}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

// Manual inspection: a patient's schedules plus its current tasks, in one call.
export async function getPatientDetails(patientId: string): Promise<{ patient: any; tasks: any }> {
  const patientRes = await api.get(`/patient/${patientId}`);
  expect(patientRes.ok(), `get /patient/${patientId} gave ${patientRes.status()}: ${await patientRes.text()}`).toBeTruthy();

  return { patient: await patientRes.json(), tasks: await getPatientTasks(patientId) };
}

// KRN-1271 — sets up a delayed schedule ("delayed schedule does not create a task right
// away") against the real "Test Automation Staging" project, and returns whatever tasks
// exist right after the PATCH, so a caller can inspect whether one was pre-created (and
// under what state) instead of being absent. Does NOT delete the patient — the caller
// decides whether to keep it around for manual inspection or clean it up.
const REAL_STAGING_PROJECT_ID = '66e954cd6a3b350013d87f35'; // "Test Automation Staging"

export async function createDelayedSchedulePatient(): Promise<{ patientId: string; tasks: any }> {
  const { patientId } = await createThrowawayPatientWithEmail('krane-1271-delay-inspect');
  const now = new Date().toISOString();
  const schedule = baseSchedule(
    {
      startOn: {
        event: 'StartDate',
        startDatetime: now,
        configuration: { delay: { durationUnit: 'day', delayDuration: 1, hour: 9, minute: 0 } },
      },
      seriesStartDatetime: now,
      action: {
        configuration: { experimentType: 'walking' },
        scheduleAction: 'CreateExperimentTask',
        expireAction: 'ExpireExperimentTask',
        remindAction: 'CheckIfExperimentTaskIsToBeReminded',
      },
      notification: { channels: ['push'] },
    },
    REAL_STAGING_PROJECT_ID,
  );

  const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
  expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

  return { patientId, tasks: await getPatientTasks(patientId) };
}

// KRN-1538 — sets up a FirstLogin schedule, activates the patient (PUT /user/activate,
// the trigger behind startOn.event === 'FirstLogin'), and polls /tasks for up to 90s.
// Does NOT delete the patient, so the caller can re-inspect it (e.g. via getPatientTasks)
// if the polling comes back empty.
export async function activateFirstLoginPatient(): Promise<{
  patientId: string;
  email: string;
  activateStatus: number;
  tasks: any;
}> {
  const { patientId, email } = await createThrowawayPatientWithEmail('krane-1538-activate-investigate');
  const projectId = await getFirstProjectId();

  const schedule = baseSchedule({ startOn: { event: 'FirstLogin' } }, projectId);
  const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
  expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

  const activateRes = await api.put('/user/activate', { data: { email, tenantName: 'orikami' } });

  const deadline = Date.now() + 90_000;
  let tasks = await getPatientTasks(patientId);
  while (tasks.count === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    tasks = await getPatientTasks(patientId);
  }

  return { patientId, email, activateStatus: activateRes.status(), tasks };
}

// Polls GET /tasks?userId=<id> (unfiltered) alongside state=open, looking for the
// unfiltered count to diverge from the state=open count (seen 2026-09-14: an existing
// "Open" task sometimes vanished from the unfiltered query while still present under
// state=open, then reappeared in both, without the task itself changing). Returns every
// mismatch found.
export async function watchTasksConsistency(
  patientId: string,
  checks = 40,
  intervalMs = 3000,
): Promise<Array<{ at: string; unfiltered: any; open: any }>> {
  const mismatches: Array<{ at: string; unfiltered: any; open: any }> = [];
  for (let i = 0; i < checks; i++) {
    const [unfiltered, open] = await Promise.all([getPatientTasks(patientId), getPatientTasks(patientId, 'open')]);
    if (unfiltered.count !== open.count) {
      mismatches.push({ at: new Date().toISOString(), unfiltered, open });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return mismatches;
}
