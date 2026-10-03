import { expect, test, type Page } from '@playwright/test';
import { demoLogin, expectNoServerError } from './helpers';

async function json(page: Page, method: 'GET' | 'POST' | 'PATCH', url: string, data?: unknown) {
  const res = method === 'GET' ? await page.request.get(url) : method === 'POST' ? await page.request.post(url, { data }) : await page.request.patch(url, { data });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON bodies in assertions
  return { status: res.status(), body: body as Record<string, any> };
}

test.describe('advisory workflow (AI-assisted, human-approved)', () => {
  test('generate → approve → publish, region-scoped, with traceability', async ({ page }) => {
    await demoLogin(page, 'State administrator', 'Rajasthan');
    const created = await json(page, 'POST', '/api/v1/advisories', { regionCodes: ['IN-RJ-CHURU'], audience: 'disaster_mgmt', scenario: 'replay' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const detail = await json(page, 'GET', `/api/v1/advisories/${id}`);
    expect(detail.status).toBe(200);
    const adv = detail.body.data;
    expect(adv.status).toBe('draft');
    expect(adv.provider).toBeTruthy();
    expect(adv.sourceRefs.length).toBeGreaterThan(0);
    expect(JSON.stringify(adv.content.limitations)).toMatch(/not an official|not an IMD/i);

    expect((await json(page, 'POST', `/api/v1/advisories/${id}/approve`)).status).toBe(200);
    expect((await json(page, 'POST', `/api/v1/advisories/${id}/approve`)).status).toBe(409); // wrong order
    expect((await json(page, 'POST', `/api/v1/advisories/${id}/publish`)).status).toBe(200);
    expect((await json(page, 'GET', `/api/v1/advisories/${id}`)).body.data.status).toBe('published');

    await page.goto(`/advisories/${id}`);
    await expect(page.getByText(/CLIMATIQ-generated/i).first()).toBeVisible();
    await expectNoServerError(page);
  });

  test('cannot generate outside the assigned state', async ({ page }) => {
    await demoLogin(page, 'State administrator', 'Rajasthan');
    const res = await json(page, 'POST', '/api/v1/advisories', { regionCodes: ['IN-MH-NAGPUR'], audience: 'public', scenario: 'replay' });
    expect(res.status).toBe(403);
  });
});

test.describe('alerts and in-app notifications', () => {
  test('scoped alerts can be acknowledged; notifications can be read', async ({ page }) => {
    await demoLogin(page, 'State administrator', 'Rajasthan');
    const alerts = await json(page, 'GET', '/api/v1/alerts?scenario=replay&status=open&limit=50');
    expect(alerts.status).toBe(200);
    const items = alerts.body.data as { id: string; status: string; regionCode: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.regionCode.startsWith('IN-RJ'))).toBe(true);
    const active = items.find((a) => a.status === 'active');
    if (active) {
      expect((await json(page, 'POST', `/api/v1/alerts/${active.id}/acknowledge`)).status).toBe(200);
      expect((await json(page, 'POST', `/api/v1/alerts/${active.id}/acknowledge`)).status).toBe(409);
    }
    const notifs = await json(page, 'GET', '/api/v1/notifications?limit=5');
    expect(notifs.status).toBe(200);
    expect(Array.isArray(notifs.body.data)).toBe(true);
    const read = await json(page, 'POST', '/api/v1/notifications/read', { all: true });
    expect(read.status).toBe(200);
    expect(read.body.data.unread).toBe(0);
  });

  test('public users cannot see operational alerts', async ({ page }) => {
    await demoLogin(page, 'Public user');
    expect((await json(page, 'GET', '/api/v1/alerts')).status).toBe(403);
  });
});

test.describe('response CRM', () => {
  test('incident lifecycle with tasks, validation and closure', async ({ page }) => {
    await demoLogin(page, 'State administrator', 'Rajasthan');
    const created = await json(page, 'POST', '/api/v1/incidents', {
      title: 'E2E: cooling centre capacity check (test)',
      description: 'Automated end-to-end test incident — fictional.',
      regionCode: 'IN-RJ-JAIPUR',
      severity: 'high',
      priority: 'p2',
    });
    expect(created.status).toBe(201);
    const ref = created.body.data.ref as string;
    expect(ref).toMatch(/^INC-\d{4}-\d{4}$/);

    expect((await json(page, 'POST', `/api/v1/incidents/${ref}/tasks`, { title: 'Verify water supply at shelters', priority: 'p2' })).status).toBe(201);
    expect((await json(page, 'POST', `/api/v1/incidents/${ref}/notes`, { body: 'Field team dispatched (test).' })).status).toBe(201);
    for (const to of ['triaged', 'in_progress']) {
      expect((await json(page, 'POST', `/api/v1/incidents/${ref}/transition`, { to })).status).toBe(200);
    }
    expect((await json(page, 'POST', `/api/v1/incidents/${ref}/transition`, { to: 'resolved' })).status).toBe(422); // summary required
    expect((await json(page, 'POST', `/api/v1/incidents/${ref}/transition`, { to: 'resolved', resolutionSummary: 'Capacity verified and supplies restocked (test).' })).status).toBe(200);
    expect((await json(page, 'POST', `/api/v1/incidents/${ref}/transition`, { to: 'closed', resolutionSummary: 'Closed after verification (test).' })).status).toBe(200);

    const detail = await json(page, 'GET', `/api/v1/incidents/${ref}`);
    expect(detail.body.data.status ?? detail.body.data.incident?.status).toBe('closed');

    await page.goto(`/response/incidents/${ref}`);
    await expect(page.getByText(ref).first()).toBeVisible();
    await expectNoServerError(page);
  });

  test('field responders cannot create incidents', async ({ page }) => {
    await demoLogin(page, 'Field response team');
    const res = await json(page, 'POST', '/api/v1/incidents', {
      title: 'Field responder attempt (should be refused)',
      description: 'Field responders may only update their own tasks.',
      regionCode: 'IN-RJ-JAIPUR',
      severity: 'low',
      priority: 'p4',
    });
    expect(res.status).toBe(403);
  });
});

test.describe('analytics exports and forecasts API', () => {
  test('forecast CSV export carries units, provenance and scope', async ({ page }) => {
    await demoLogin(page, 'Climate analyst');
    const fc = await json(page, 'GET', '/api/v1/forecasts?scenario=replay&level=state');
    expect(fc.status).toBe(200);
    const runId = fc.body.meta.run.id as string;
    expect(fc.body.data.length).toBeGreaterThan(30);
    expect(fc.body.data[0].confidence.isProbability).toBe(false);

    const csv = await page.request.get(`/api/v1/export/forecasts.csv?run=${runId}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toMatch(/attachment; filename=/);
    const header = (await csv.text()).split(/\r?\n/)[0];
    for (const col of ['region_code', 'predicted_tmax_c', 'severity', 'data_kind', 'source']) expect(header).toContain(col);
  });

  test('response team cannot export analytics', async ({ page }) => {
    await demoLogin(page, 'Regional response team', 'Rajasthan');
    const res = await page.request.get('/api/v1/export/history.csv?region=IN-RJ&from=2024-05-01&to=2024-05-31');
    expect(res.status()).toBe(403);
  });
});

test.describe('IoT ingestion API', () => {
  test('rejects requests without a valid station key', async ({ request }) => {
    const noKey = await request.post('/api/v1/stations/DOES-NOT-EXIST/observations', { data: { observedAt: new Date().toISOString(), tempC: 30 } });
    expect([401, 404]).toContain(noKey.status());
    const badKey = await request.post('/api/v1/stations/DOES-NOT-EXIST/observations', {
      headers: { authorization: 'Bearer not-a-real-key' },
      data: { observedAt: new Date().toISOString(), tempC: 30 },
    });
    expect([401, 404]).toContain(badKey.status());
  });
});

test.describe('guided tour & demo role switching', () => {
  test('tour starts on first demo sign-in and can be skipped', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('cq_intro_seen', '1');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('cq.tour.v1'));
    await page.getByRole('button', { name: /Climate analyst/i }).first().click();
    await page.waitForURL(/\/command/);
    const dialog = page.getByRole('dialog', { name: /Welcome to CLIMATIQ/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: /Live data or historical replay/i })).toBeVisible();
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('switching roles changes permissions', async ({ page }) => {
    await demoLogin(page, 'System administrator');
    await page.goto('/command');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: /Field response team/i }).click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Administration' })).toHaveCount(0);
  });
});
