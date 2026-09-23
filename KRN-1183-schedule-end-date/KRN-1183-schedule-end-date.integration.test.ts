import { describe, test, expect } from 'vitest';
import { api } from '../apiClient';
import { baseSchedule, getFirstProjectId, createThrowawayPatient } from '../helpers';

describe('KRN-1183 — setting a schedule end date', () => {
  test('KRN-1183-001: happy path: admin can set an end date on a schedule', async () => {
    const projectId = await getFirstProjectId();
    const patientId = await createThrowawayPatient('krane-1183-test');
    try {
      const seriesEndDatetime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const schedule = baseSchedule({ seriesEndDatetime }, projectId);

      const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
      expect(patchRes.ok(), `patch /user/${patientId} gave ${patchRes.status()}: ${await patchRes.text()}`).toBeTruthy();
      const getRes = await api.get(`/patient/${patientId}`);
      const patient = await getRes.json();
      expect(getRes.ok(), `get /patient/${patientId} gave ${getRes.status()}: ${await getRes.text()}`).toBeTruthy();
      const savedSchedule = patient.schedules[0];
      expect(savedSchedule.seriesEndDatetime).toBe(seriesEndDatetime);
    } finally {
      const del = await api.delete(`/user/${patientId}`);
      console.log('cleaning up test patient, status:', del.status());
    }
  });

  test('KRN-1183-002: no more tasks/reminders are created after the end date', async () => {
    const patientId = await createThrowawayPatient('krane-1183-test');
    const seriesEndDatetime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const tasksRes = await api.get(`/tasks?userId=${patientId}`);
    expect(tasksRes.ok(), `get /tasks gave ${tasksRes.status()}: ${await tasksRes.text()}`).toBeTruthy();
    const tasks = await tasksRes.json();
    expect(tasks.items).toHaveLength(0);
  });

  // KRN-1183-BUG-1 — PATCH /user/{userId} intermittently returns 500 ("Cannot read
  // properties of null (reading 'roles')") when several requests run concurrently for
  // independent patients; never happens one at a time. A different random subset fails
  // each run rather than all-at-once, which points to a server-side race condition
  // rather than a staging redeploy. Confirmed the failed patient is left clean
  // (schedules: []), not half-saved. Open question for Andres: what reads "roles" in
  // this handler, and why is it null under concurrent load?
  //
  // Patient creation (POST /user/patient) is rate-limited (429) at 8 concurrent
  // requests, so patients are created sequentially here — only the PATCH calls run
  // concurrently, to isolate the race condition above from that unrelated rate limit.
  test(
    'KRN-1183-003 (KRN-1183-BUG-1): concurrent PATCH /user/{userId} requests do not all succeed',
    { timeout: 60_000 },
    async () => {
      const projectId = await getFirstProjectId();

      const concurrency = 8;
      const patientIds: string[] = [];
      for (let i = 0; i < concurrency; i++) {
        patientIds.push(await createThrowawayPatient(`krane-1183-concurrent-${i}`));
      }

      try {
        const results = await Promise.all(
          patientIds.map(async (patientId) => {
            const schedule = baseSchedule({ seriesEndDatetime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }, projectId);
            const patchRes = await api.patch(`/user/${patientId}`, { data: { schedules: [schedule] } });
            return { patientId, status: patchRes.status(), body: patchRes.ok() ? null : await patchRes.text() };
          }),
        );

        const failures = results.filter((r) => r.status < 200 || r.status >= 300);
        expect(failures, `expected all ${concurrency} concurrent PATCH requests to succeed, got: ${JSON.stringify(failures)}`).toHaveLength(0);
      } finally {
        for (const id of patientIds) {
          const del = await api.delete(`/user/${id}`);
          console.log('cleaning up test patient', id, 'status:', del.status());
        }
      }
    },
  );
});
