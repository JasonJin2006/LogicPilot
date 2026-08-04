import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = EDGE_CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:64749', { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForSelector('.model-canvas', { timeout: 20_000 });
  console.log('app served, canvas present');

  // connect: the app server's /api/config injects the gateway URL
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('.conn-connected', { timeout: 15_000 });
  const urlShown = await page.locator('.url-input').inputValue();
  console.log('resolved gateway url:', urlShown);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // run (empty canvas -> served model)
  await page.locator('.canvas-run').click();
  await page.getByRole('dialog', { name: 'Run' }).waitFor();
  for (const [label, value] of [['arrivals', '150'], ['warmup', '20'], ['speed', '80'], ['reps', '1']]) {
    await page.locator('label.field', { hasText: label }).locator('input').fill(value);
  }
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(() => document.querySelector('.console-log')?.textContent?.includes('run run-'), undefined, { timeout: 20_000 });
  console.log('run started on the app-server gateway');
  await page.waitForFunction(() => document.querySelector('.console-log')?.textContent?.includes('finished'), undefined, { timeout: 60_000 });
  console.log('run finished');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // AI build through the production backend
  await page.locator('.tab-label', { hasText: 'AI' }).click();
  await page.locator('.ai-input').fill('build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0');
  await page.getByRole('button', { name: 'generate + run' }).click();
  await page.waitForSelector('.ai-result', { timeout: 90_000 });
  const aiOk = (await page.locator('.ai-result').textContent())?.includes('compiled in');
  console.log('AI build via app server:', aiOk);

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
} finally { await browser.close(); }
