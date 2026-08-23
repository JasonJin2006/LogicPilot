// Targeted check for A2: session row menu offers rename and delete; rename
// persists a new title, delete removes the session after confirmation.
//
// Prereqs: dev server on LP_DEV_URL (any provider state; the flow only needs
// the panel to create a session).

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

// Create a session, then go back to the list.
await page.fill('.ai-input', 'Initial session title');
await page.press('.ai-input', 'Enter');
await page.locator('.ai-turn').first().waitFor({ timeout: 20000 });
await page.locator('button[aria-label="Back to sessions"]').click();
await page.locator('.ai-session-row').first().waitFor({ timeout: 5000 });

// Rename via the row menu.
const openMenu = async () => {
  const menu = page.locator('.ai-session-menu > summary').first();
  await menu.click();
  const pop = page.locator('.ai-session-menu-pop').first();
  try {
    await pop.waitFor({ state: 'visible', timeout: 1500 });
  } catch {
    await menu.click();
  }
  await pop.waitFor({ state: 'visible', timeout: 3000 });
};
await openMenu();
await page.locator('.ai-session-menu-pop button', { hasText: 'Rename' }).click();
const promptDialog = page.locator('.dialog-card', { hasText: 'Rename session' });
await promptDialog.waitFor({ timeout: 5000 });
await promptDialog.locator('input').fill('Renamed session');
await promptDialog.locator('button', { hasText: 'Rename' }).first().click();
await page.waitForTimeout(500);
check(
  (await page.locator('.ai-session-row').first().innerText()).includes('Renamed session'),
  'session title updates after rename',
);

// Delete via the row menu with confirmation.
await openMenu();
await page.locator('.ai-session-menu-pop button', { hasText: 'Delete' }).click();
const confirmDialog = page.locator('.dialog-card', { hasText: 'Delete session' });
await confirmDialog.waitFor({ timeout: 5000 });
await confirmDialog.locator('button', { hasText: 'Delete' }).click();
await page.waitForTimeout(500);
check(
  (await page.locator('.ai-session-row').count()) === 0,
  'session removed after confirm',
);
await page.screenshot({ path: join(OUT, 'ai-session-menu.png') });

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai session-menu checks passed');
