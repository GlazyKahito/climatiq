import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { demoLogin } from './helpers';

const PUBLIC = ['/', '/login', '/portal', '/portal/IN-RJ?scenario=replay', '/methodology'];
const PRIVATE = ['/command', '/forecasts', '/forecasts/IN-RJ-CHURU', '/stations', '/advisories', '/response', '/analytics', '/admin', '/settings'];

async function scan(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['region']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length) {
    console.log(`\n[a11y] ${path}`);
    for (const v of serious) console.log(`  - ${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }
  return serious;
}

test.describe('accessibility (axe, WCAG 2 A/AA, serious+critical)', () => {
  for (const path of PUBLIC) {
    test(`public ${path}`, async ({ page }) => {
      const v = await scan(page, path);
      expect(v.map((x) => x.id)).toEqual([]);
    });
  }
  test('signed-in modules', async ({ page }) => {
    await demoLogin(page, 'System administrator');
    const failures: string[] = [];
    for (const path of PRIVATE) {
      const v = await scan(page, path);
      if (v.length) failures.push(`${path}: ${v.map((x) => x.id).join(', ')}`);
    }
    expect(failures).toEqual([]);
  });

  test('keyboard: skip link and focus are available in the app shell', async ({ page }) => {
    await demoLogin(page, 'Climate analyst');
    await page.goto('/command');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
