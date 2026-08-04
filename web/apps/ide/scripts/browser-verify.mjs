// Browser end-to-end verification for the LogicPilot IDE visualization
// slice: loads the Vite dev page, connects to lp-server, starts a small
// M/M/1 run and asserts the queue animation, charts, status bar and the
// RunFinished statistics panel all update. Screenshots land in .verify/out
// (repo root, untracked scratch dir).
//
// Prereqs: lpcli serve running on ws://127.0.0.1:8089/sim, `pnpm dev` up,
// system Edge installed (no Playwright browser download required).
//
// Usage: node web/apps/ide/scripts/browser-verify.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const OUT = join(here, '..', '..', '..', '..', '.verify', 'out');
mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log('[browser]', ...args);

// Drive the system Edge (no bundled browser download needed).
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('[browser] msedge.exe not found');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

try {
  log('loading http://localhost:5173 ...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForSelector('.queue-canvas canvas', { timeout: 20_000 });
  await page.waitForSelector('.charts canvas', { timeout: 20_000 });
  log('page loaded: pixi canvas + chart canvases present');
  await page.screenshot({ path: join(OUT, '1-loaded.png') });

  // Connect first: the parameter inputs stay disabled until the socket is
  // open.
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('.conn-connected', { timeout: 10_000 });
  log('connected to ws://127.0.0.1:8089/sim');

  // Small run so the browser session finishes quickly.
  for (const [label, value] of [
    ['arrivals', '200'],
    ['warmup', '30'],
    ['speed', '50'],
    ['reps', '3'],
  ]) {
    await page.locator('label.field', { hasText: label }).locator('input').fill(value);
  }

  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(
    () => document.querySelector('.status-bar')?.textContent?.includes('ack: {"ok":true'),
    { timeout: 10_000 },
  );
  log('start acked by gateway');

  // Let telemetry stream for a while; the status bar seq/sim_time must move.
  const seqText = () =>
    page.evaluate(() => {
      const text = document.querySelector('.status-bar')?.textContent ?? '';
      const m = text.match(/seq: (\d+)/);
      return m ? Number(m[1]) : -1;
    });
  await page.waitForTimeout(5000);
  const seqAt5 = await seqText();
  await page.waitForTimeout(4000);
  const seqLater = await seqText();
  if (!(seqAt5 > 0) || !(seqLater > seqAt5)) {
    throw new Error(`status bar seq not advancing (t1=${seqAt5}, t2=${seqLater})`);
  }
  log(`telemetry streaming: seq ${seqAt5} -> ${seqLater}`);

  const chartState = await page.evaluate(() => {
    const canvases = document.querySelectorAll('.charts canvas');
    return {
      count: canvases.length,
      fpsText: document.querySelector('.status-bar')?.textContent ?? '',
    };
  });
  if (chartState.count !== 3) throw new Error(`expected 3 chart canvases, got ${chartState.count}`);
  log(`charts drawn (3 uPlot canvases); status bar: ${chartState.fpsText.trim()}`);
  await page.screenshot({ path: join(OUT, '2-running.png') });

  // Wait for RunFinished -> stats panel.
  await page.waitForSelector('.run-status.status-completed', { timeout: 180_000 });
  const statsText = await page.locator('.results').textContent();
  for (const key of ['Wq.mean', 'throughput.mean', 'L.mean', 'confidence']) {
    if (!statsText?.includes(key)) throw new Error(`stats panel missing ${key}`);
  }
  log('RunFinished panel shows Completed + full stats table');
  await page.screenshot({ path: join(OUT, '3-finished.png') });

  // AI model panel: generate a model from a natural-language prompt.
  await page.locator('.ai-input').fill(
      'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0');
  await page.getByRole('button', { name: 'generate + run' }).click();
  await page.waitForSelector('.ai-result', { timeout: 90_000 });
  const aiText = await page.locator('.ai-result').textContent();
  if (!aiText?.includes('compiled in')) {
    throw new Error('AI panel did not show a compiled model');
  }
  log('AI panel generated and ran a model from the prompt');
  await page.screenshot({ path: join(OUT, '4-ai-model.png') });

  // AI panel: parameter optimization from a natural-language prompt.
  await page.locator('.ai-input').fill(
      'minimize Wq over servers 1..4 for an M/M/1 queue with arrival 0.8 ' +
      'and service 1.0');
  await page.getByRole('button', { name: 'optimize' }).click();
  await page.waitForSelector('.ai-scores', { timeout: 90_000 });
  const optimizeText = await page.locator('.ai-result').textContent();
  if (!optimizeText?.includes('best servers=')) {
    throw new Error('AI panel did not show an optimization result');
  }
  log('AI panel optimized a model parameter from the prompt');
  await page.screenshot({ path: join(OUT, '5-ai-optimize.png') });

  if (consoleErrors.length > 0) {
    throw new Error(`console errors: ${consoleErrors.join(' | ')}`);
  }
  log('PASS');
} catch (err) {
  await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {});
  console.error('[browser] FAIL:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
