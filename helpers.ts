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
