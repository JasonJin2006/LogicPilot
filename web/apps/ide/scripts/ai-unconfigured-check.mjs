// Targeted check: with no AI provider configured, the AI panel must show a
// real error state (banner + inline error) and must NOT fabricate an
// assistant conversation turn when the user sends a message.
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

// The provider state poll runs every ~2.5s; the banner appears once the
// server reports the assistant is unconfigured.
const banner = page.locator('.ai-provider-error');
await banner.waitFor({ timeout: 10000 });
check(await banner.isVisible(), 'unconfigured banner .ai-provider-error is visible');
check(
  (await banner.innerText()).includes('AI 模型未配置'),
  'banner states the model is unconfigured',
);
check(
  await page.locator('.ai-panel').evaluate((el) => el.textContent.includes('打开设置')),
  'banner offers a settings shortcut',
);

const turnsBefore = await page.locator('.ai-turn').count();
await page.fill('.ai-input', 'hello');
await page.press('.ai-input', 'Enter');

// Give the guard a moment to run; the panel must not grow a turn.
await page.waitForTimeout(1500);
const turnsAfter = await page.locator('.ai-turn').count();
check(
  turnsAfter === turnsBefore,
  `no fabricated conversation turn (turns ${turnsBefore} -> ${turnsAfter})`,
);
check(
  (await page.locator('.ai-error').count()) > 0,
  'inline error is shown near the composer',
);
check(await banner.isVisible(), 'banner still visible after send attempt');

await page.screenshot({ path: join(OUT, 'ai-unconfigured-banner.png') });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai-unconfigured checks passed');
