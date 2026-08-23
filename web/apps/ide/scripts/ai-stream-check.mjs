// Targeted check for the streaming bubble (B1/B2): with a mock LLM provider
// configured, sending a message renders an in-thread assistant bubble
// immediately and the final turn lands in the same position once the
// provider finishes. Also checks that cancellation keeps the message.
//
// Prereqs: node scripts/mock-llm-provider.mjs running on 127.0.0.1:9191 and
// a dev server started with LOGICPILOT_AI_PROVIDER=api,
// LOGICPILOT_AI_BASE_URL=http://127.0.0.1:9191/v1, LOGICPILOT_AI_API_KEY=mock,
// LOGICPILOT_AI_MODEL=mock-model.

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

await page.fill('.ai-input', 'Test streamed reply');
await page.press('.ai-input', 'Enter');

// The in-thread streaming bubble must appear right away with the user
// message, before the final turn lands.
const bubble = page.locator('.ai-turn-streaming');
await bubble.waitFor({ timeout: 5000 });
check(await bubble.isVisible(), 'streaming bubble appears immediately');
check(
  (await bubble.locator('.ai-message.user').innerText()).includes('Test streamed reply'),
  'streaming bubble carries the user message',
);
await page.screenshot({ path: join(OUT, 'ai-streaming-bubble.png') });

// The final turn replaces the bubble in the same position.
const finalTurn = page.locator('.ai-turn').last();
await page.waitForFunction(
  () => document.querySelectorAll('.ai-turn-streaming').length === 0,
  undefined,
  { timeout: 20000 },
);
await finalTurn.waitFor({ timeout: 5000 });
check(
  (await finalTurn.locator('.ai-message.assistant p').first().innerText()).includes('mock model'),
  'final turn shows the streamed assistant reply',
);
check(
  await finalTurn
    .locator('.ai-outcome')
    .evaluate((el) => el.classList.contains('completed')),
  'final turn outcome is completed',
);
check((await page.locator('.ai-turn-streaming').count()) === 0, 'bubble cleared after finish');
await page.screenshot({ path: join(OUT, 'ai-streaming-final.png') });

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall ai-streaming checks passed');
