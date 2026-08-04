// Browser end-to-end verification for the LogicPilot IDE: loads the Vite
// dev page, connects through the settings dialog, starts a small M/M/1 run
// and asserts the queue animation, live telemetry (Run side panel), status
// bar and the AI panel all update. Screenshots land in .verify/out (repo
// root, untracked scratch dir).
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
  log('page loaded: queue canvas present');
  await page.screenshot({ path: join(OUT, '1-loaded.png') });

  // Connection + run setup live in the settings dialog (activity bar gear).
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('.conn-connected', { timeout: 10_000 });
  log('connected to ws://127.0.0.1:8089/sim');

  // Theme switching (light / dark) lives in the same dialog.
  await page.getByRole('button', { name: 'Light' }).click();
  const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (lightTheme !== 'light') throw new Error(`expected light theme, got ${lightTheme}`);
  await page.getByRole('button', { name: 'Dark' }).click();
  const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (darkTheme !== 'dark') throw new Error(`expected dark theme, got ${darkTheme}`);
  log('theme switching: light <-> dark');

  // Run parameters + Start from the settings dialog.
  for (const [label, value] of [
    ['arrivals', '200'],
    ['warmup', '30'],
    ['speed', '50'],
    ['reps', '1'],
  ]) {
    await page.locator('label.field', { hasText: label }).locator('input').fill(value);
  }
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(
    () => document.querySelector('.status-bar')?.textContent?.includes('ack: {"ok":true'),
    undefined,
    { timeout: 30_000 },
  );
  log('start acked by gateway');
  await page.getByRole('button', { name: '✕' }).click();

  // Live telemetry: switch to the Run side panel and read seq progression.
  await page.locator('.activity-bar').getByRole('button', { name: 'Run' }).click();
  const seqFromPanel = () =>
    page.evaluate(() => {
      const kv = [...document.querySelectorAll('.side-kv')].find((row) =>
        row.querySelector('.k')?.textContent?.includes('seq'),
      );
      const text = kv?.querySelector('.v')?.textContent ?? '-1';
      return Number(text);
    });
  await page.waitForTimeout(5000);
  const seqAt5 = await seqFromPanel();
  await page.waitForTimeout(4000);
  const seqLater = await seqFromPanel();
  if (!(seqAt5 > 0) || !(seqLater > seqAt5)) {
    throw new Error(`run telemetry not advancing (t1=${seqAt5}, t2=${seqLater})`);
  }
  log(`telemetry streaming: seq ${seqAt5} -> ${seqLater}`);

  // Wait for the run to actually finish on the gateway (its worker is
  // single-threaded; the AI steps below must not race a leftover run).
  await page.waitForFunction(
    () => document.querySelector('.console-log')?.textContent?.includes('finished'),
    undefined,
    { timeout: 120_000 },
  );
  log('run finished on gateway');
  await page.screenshot({ path: join(OUT, '2-running.png') });

  // AI panel (right): generate / optimize / explain / trajectory.
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page
    .locator('.ai-input')
    .fill('build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0');
  await page.getByRole('button', { name: 'generate + run' }).click();
  await page.waitForSelector('.ai-result', { timeout: 90_000 });
  const aiText = await page.locator('.ai-result').textContent();
  if (!aiText?.includes('compiled in')) {
    throw new Error('AI panel did not show a compiled model');
  }
  log('AI panel generated and ran a model from the prompt');
  await page.screenshot({ path: join(OUT, '3-ai-model.png') });

  await page
    .locator('.ai-input')
    .fill('minimize Wq over servers 1..4 for an M/M/1 queue with arrival 0.8 ' + 'and service 1.0');
  await page.getByRole('button', { name: 'optimize' }).click();
  await page.waitForSelector('.ai-scores', { timeout: 90_000 });
  const optimizeText = await page.locator('.ai-result').textContent();
  if (!optimizeText?.includes('best servers=')) {
    throw new Error('AI panel did not show an optimization result');
  }
  const curve = await page.$('.ai-opt-chart polyline');
  if (!curve) {
    throw new Error('AI panel did not render the optimization curve');
  }
  log('AI panel optimized a model parameter from the prompt');
  await page.screenshot({ path: join(OUT, '4-ai-optimize.png') });

  await page
    .locator('.ai-input')
    .fill('build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0');
  await page.getByRole('button', { name: 'explain' }).click();
  await page.waitForSelector('.ai-findings', { timeout: 90_000 });
  const explainText = await page.locator('.ai-result').textContent();
  if (!explainText?.includes('throughput=')) {
    throw new Error('AI panel did not show an explanation');
  }
  log('AI panel explained the model bottleneck from the prompt');

  await page.locator('.ai-input').fill('build an exponential decay model with rate 0.5');
  await page.getByRole('button', { name: 'generate + run' }).click();
  await page.waitForSelector('.ai-trajectory', { timeout: 90_000 });
  log('AI panel charted a continuous-model trajectory');
  await page.screenshot({ path: join(OUT, '5-ai-trajectory.png') });

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
