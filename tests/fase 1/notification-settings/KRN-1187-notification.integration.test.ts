import { describe, test, expect } from 'vitest';
import { api } from '../../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../../helpers';

describe('KRN-1187 — setting a notification', () => {
  test('KRN-1187-001 & KRN-1187-002: happy path: reminders and notification are saved on the schedule', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1187-test');

    try {
      // reminder.title is intentionally left out: see the bug test below (KRN-1187-BUG-1).
      const reminders = [
        { channels: ['push'], message: "Don't forget your task", priority: 1, timeOffset: 60 },
      ];
      const notification = { channels: ['push', 'email'], title: 'New task', message: 'You have a task waiting', priority: 1 };
      const schedule = baseSchedule({ reminders, notification }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();

      const getRes = await api.get(`/patient/${patientId}`);
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const patient = await getRes.json();
      const savedSchedule = patient.schedules[0];

      expect(savedSchedule.reminders).toEqual(reminders);
      expect(savedSchedule.notification).toEqual(notification);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  // KRN-1187-BUG-1: PATCH /user/{userId} throws "Failed to schedule tasks" as soon as a
  // reminder has a title. channels+timeOffset (required), message and priority work fine
  // on their own; only title breaks it. If this test suddenly passes, the bug has been
  // fixed — put reminders.title back in the happy path above and delete this test.
  test.fails('KRN-1187-003: known bug: reminder.title causes a server_error on PATCH', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1187-bug');

    try {
      const reminders = [{ channels: ['push'], timeOffset: 60, title: 'Reminder' }];
      const schedule = baseSchedule({ reminders }, projectId);
      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });
});
