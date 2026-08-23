// Targeted check for the real model list in the composer (E1): opening the
// model dropdown lists discovered models (mock provider), selecting one
// saves it as the session model without an error, and the settings entry
// stays reachable.
//
// Prereqs: mock-llm-provider.mjs on 127.0.0.1:9191 and a dev server started
// with LOGICPILOT_AI_PROVIDER=api / LOGICPILOT_AI_BASE_URL=http://127.0.0.1:9191/v1
// / LOGICPILOT_AI_API_KEY=mock / LOGICPILOT_AI_MODEL=mock-model.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', '..', '..', '.verify', 'out');
mkdirSync(OUT, { recursive: true });

const EDGE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('no Chrome/Chromium/Edge executable found');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });

const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${message}`);
  if (!condition) failures.push(message);
};

await page.goto(process.env.LP_DEV_URL ?? 'http://localhost:5174/', {
  waitUntil: 'domcontentloaded',
});
await page.locator('.ai-input').waitFor({ timeout: 15000 });
await page
  .locator('.ai-model-select summary span')
  .filter({ hasText: 'mock-model' })
  .waitFor({ timeout: 10000 });

await page.locator('.ai-model-select summary').click();
const popover = page.locator('.ai-model-select .ai-select-popover');
const mockItem = popover.locator('button', { hasText: 'mock-model' });
await mockItem.waitFor({ timeout: 8000 });
check(
  (await popover.locator('button', { hasText: '自动' }).count()) > 0,
  'popover lists the 自动 option',
);
check((await mockItem.count()) > 0, 'popover lists the discovered model');
check(
  (await popover.locator('button', { hasText: '设置' }).count()) > 0,
  'popover keeps the settings entry',
);
await mockItem.first().click();
await page.waitForTimeout(800);
check(
  (await page.locator('.ai-error').count()) === 0,
  'selecting a model does not surface an error',
);
check(
  (await page.locator('.ai-model-select summary span').first().innerText()) === 'mock-model',
  'model label reflects the selection',
);
await page.screenshot({ path: join(OUT, 'ai-model-list.png') });

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai-model checks passed');
