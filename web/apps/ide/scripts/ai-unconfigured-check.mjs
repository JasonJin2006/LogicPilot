// Targeted check: with no AI provider configured, sending a conversation
// message must still enter a session and commit the user's turn while the
// assistant side shows a genuine error state. There must be no persistent
// banner and no fabricated assistant reply.
//
// Prereqs: `pnpm dev` in web/apps/ide, no LOGICPILOT_AI_* / OPENAI_* env.

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

// The provider state poll runs every ~2.5s and flips the model label to
// "Not configured". There must be no persistent banner.
check(
  (await page.locator('.ai-provider-error').count()) === 0,
  'no persistent unconfigured banner',
);
await page
  .locator('.ai-model-select summary span')
  .filter({ hasText: 'Not configured' })
  .waitFor({ timeout: 10000 });
check(true, 'model label reads "Not configured"');

const turnsBefore = await page.locator('.ai-turn').count();
await page.fill('.ai-input', 'hello');
await page.press('.ai-input', 'Enter');

// The turn must land: session entered, user message committed, assistant
// side shows the not-configured error instead of a fabricated reply.
await page.locator('.ai-turn').nth(turnsBefore).waitFor({ timeout: 10000 });
const turn = page.locator('.ai-turn').nth(turnsBefore);
check((await page.locator('.ai-session-header').count()) > 0, 'session created and entered');
check((await turn.locator('.ai-message.user').innerText()).includes('hello'), 'user message committed');
check(
  (await turn.locator('.ai-error').innerText()).includes('未配置 AI 模型'),
  'assistant side shows the not-configured error',
);
check(
  await turn
    .locator('.ai-outcome')
    .evaluate((el) => el.classList.contains('run_failed')),
  'turn outcome is run_failed',
);
check(
  !(await turn.locator('.ai-message.assistant > div > p').first().innerText()).includes(
    '未配置 AI 模型',
  ),
  'error is not fabricated as a plain assistant reply',
);

await page.screenshot({ path: join(OUT, 'ai-unconfigured-turn.png') });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai-unconfigured turn checks passed');
