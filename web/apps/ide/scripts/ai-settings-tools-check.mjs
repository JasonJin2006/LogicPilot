// Targeted check for F1: the tool switches moved out of the composer popover
// into Settings → AI & Models, and toggling them updates the panel state.
//
// Prereqs: mock LLM provider + dev server with LOGICPILOT_AI_* env (any
// configured provider is fine).

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

await page.goto(process.env.LP_DEV_URL ?? 'http://localhost:5173/', {
  waitUntil: 'domcontentloaded',
});
await page.locator('.ai-input').waitFor({ timeout: 15000 });

check(
  (await page.locator('.ai-configure-tools').count()) === 0,
  'composer tool popover is gone',
);

await page.locator('button[aria-label="Settings"]').click();
await page.locator('.settings-nav button', { hasText: 'AI & Models' }).click();
const toggles = page.locator('.settings-ai-tool-toggle');
await toggles.first().waitFor({ timeout: 8000 });
check((await toggles.count()) === 2, 'settings lists both tool toggles');
check(
  (await toggles.nth(0).locator('.ai-toggle').evaluate((el) => el.classList.contains('on'))),
  'modeling tools default on',
);
await toggles.nth(1).click();
check(
  (await toggles.nth(1).locator('.ai-toggle').evaluate((el) => el.classList.contains('on'))),
  'source editing toggle flips on',
);
await page.locator('.settings-nav button', { hasText: 'AI & Models' }).click();
await page.screenshot({ path: join(OUT, 'ai-settings-tools.png') });

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai settings-tools checks passed');
