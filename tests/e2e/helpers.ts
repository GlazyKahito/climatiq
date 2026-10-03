import { expect, type Page } from '@playwright/test';

/** One-click demo sign-in by role label as shown on /login (e.g. "System administrator"). */
export async function demoLogin(page: Page, roleLabel: string, scope?: string) {
  await page.context().clearCookies();
  // Skip the guided tour so it doesn't cover the page under test.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cq.tour.v1', JSON.stringify({ status: 'done', step: 0 }));
      sessionStorage.setItem('cq_intro_seen', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/login');
  const card = page.getByRole('button', { name: new RegExp(`${roleLabel}${scope ? `[\\s\\S]*${scope}` : ''}`, 'i') }).first();
  await card.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
}

export async function expectNoServerError(page: Page) {
  await expect(page.locator('body')).not.toContainText(/Application error|Unhandled Runtime Error|Internal Server Error/i);
}
