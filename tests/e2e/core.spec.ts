import { expect, test } from '@playwright/test';
import { demoLogin, expectNoServerError } from './helpers';

test.describe('public experience', () => {
  test('landing shows brand, tagline and Explore Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('CLIMATIQ').first()).toBeVisible();
    await expect(page.getByText(/Understand the Heat\.\s*Anticipate the Risk\./).first()).toBeVisible();
    const cta = page.getByRole('link', { name: /Explore Dashboard/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /\/command/);
    await expectNoServerError(page);
  });

  test('dashboard redirects signed-out visitors to sign-in', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/command');
    await expect(page).toHaveURL(/\/login\?next=%2Fcommand/);
  });

  test('public portal works without an account and labels its origin', async ({ page }) => {
    await page.goto('/portal');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/CLIMATIQ-generated/i).first()).toBeVisible();
    await expect(page.getByText(/mausam\.imd\.gov\.in/).first()).toBeVisible();
    await page.goto('/portal?scenario=replay');
    await expect(page.getByText(/Historical replay/i).first()).toBeVisible();
    await page.goto('/portal/IN-RJ-CHURU?scenario=replay');
    await expect(page.getByRole('heading', { name: 'Churu' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoServerError(page);
  });

  test('methodology explains sources and limitations', async ({ page }) => {
    await page.goto('/methodology');
    await expect(page.getByRole('heading', { name: /Data sources/i })).toBeVisible();
    await expect(page.getByText(/not authenticated by the Survey of India/i).first()).toBeVisible();
  });
});

test.describe('authentication & role-based access', () => {
  test('system administrator sees every module', async ({ page }) => {
    await demoLogin(page, 'System administrator');
    await page.goto('/command');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Command center', 'Heatwave prediction', 'Weather stations', 'Advisories & alerts', 'Response CRM', 'Climate analytics', 'Administration']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /Operate & monitor/i })).toBeVisible();
    await expectNoServerError(page);
  });

  test('field responder cannot open administration or analytics', async ({ page }) => {
    await demoLogin(page, 'Field response team');
    await page.goto('/command');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Administration' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Climate analytics' })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/forbidden/);
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test('demo reset refuses without the confirmation phrase', async ({ page }) => {
    await demoLogin(page, 'System administrator');
    await page.goto('/admin?tab=demo');
    await page.getByLabel(/Type "RESET DEMO" to confirm/).fill('reset');
    await page.getByRole('button', { name: /Reset demo data/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Type RESET DEMO to confirm/ })).toBeVisible();
  });

  test('sign-out clears the session', async ({ page }) => {
    await demoLogin(page, 'Climate analyst');
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/command');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('API', () => {
  test('health reports database up', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).db).toBe('up');
  });

  test('region search returns hierarchy', async ({ request }) => {
    const res = await request.get('/api/v1/regions?q=Jaip');
    const json = await res.json();
    expect(json.data.some((r: { code: string }) => r.code === 'IN-RJ-JAIPUR')).toBeTruthy();
  });

  test('region search validates input', async ({ request }) => {
    const res = await request.get(`/api/v1/regions?q=${'x'.repeat(100)}`);
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_request');
  });

  test('cron endpoint rejects missing credentials', async ({ request }) => {
    const res = await request.get('/api/v1/cron/refresh');
    expect([401, 503]).toContain(res.status());
  });
});
