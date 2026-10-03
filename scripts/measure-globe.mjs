/**
 * Dev utility: rough globe performance probe in headless Chromium (software WebGL → render cost shows up as CPU time).
 * Reports long-task time during load/intro and main-thread frame timing + canvas redraw rate while idle.
 *   node scripts/measure-globe.mjs [url]
 */
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:3100/';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try { sessionStorage.setItem('cq_intro_seen', '1'); } catch {}
  window.__longTasks = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks += e.duration; }).observe({ type: 'longtask', buffered: true });
  // Count WebGL draw calls per second (proxy for redraws).
  const proto = WebGL2RenderingContext.prototype; const orig = proto.drawArrays; const origE = proto.drawElements;
  window.__draws = 0; proto.drawArrays = function (...a) { window.__draws++; return orig.apply(this, a); };
  proto.drawElements = function (...a) { window.__draws++; return origE.apply(this, a); };
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(8000);
const load = await page.evaluate(() => ({ longTaskMs: Math.round(window.__longTasks), tier: document.querySelector('[data-globe-tier]')?.getAttribute('data-globe-tier') ?? 'n/a' }));
const idle = await page.evaluate(async () => {
  const d0 = window.__draws, l0 = window.__longTasks;
  const deltas = []; let last = performance.now();
  await new Promise((res) => { const end = last + 4000; const f = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  deltas.sort((a, b) => a - b);
  return { drawCallsPerSec: Math.round((window.__draws - d0) / 4), longTaskMsPer4s: Math.round(window.__longTasks - l0), medianFrameMs: +deltas[Math.floor(deltas.length / 2)].toFixed(1), p95FrameMs: +deltas[Math.floor(deltas.length * 0.95)].toFixed(1) };
});
console.log(JSON.stringify({ url, load, idle }));
await browser.close();
