// Browser end-to-end verification for the LogicPilot IDE: loads the Vite
// dev page, connects through the settings dialog, starts a small M/M/1 run
// and asserts the modeling canvas, the gateway event log, the status bar
// and the AI panel all update. Screenshots land in .verify/out (repo root,
// untracked scratch dir).
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
  // With nothing open the center shows its empty state, not a canvas tab.
  await page.waitForSelector('.center-empty', { timeout: 20_000 });
  log('page loaded: center empty state');
  await page.screenshot({ path: join(OUT, '1-loaded.png') });

  // New project opens the root canvas tab (canvas tabs are per-element).
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog', { name: 'New Project' }).waitFor();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('.model-canvas', { timeout: 20_000 });
  const canvasText = await page.evaluate(
    () => document.querySelector('.model-canvas')?.textContent ?? '',
  );
  if (!canvasText.includes('Drag blocks from the palette')) {
    throw new Error('modeling canvas missing the empty-state hint');
  }
  log('root canvas open after new project');

  // Connection + run setup live in the settings dialog (activity bar gear).
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  // The IDE auto-connects on load (the gateway is up for this test); the
  // dialog shows Disconnect once connected. Fall back to a manual Connect
  // if the auto attempt already gave up.
  await page
    .waitForFunction(
      () => document.querySelector('.conn-connected') !== null,
      undefined,
      { timeout: 15_000 },
    )
    .catch(async () => {
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.waitForSelector('.conn-connected', { timeout: 10_000 });
    });
  log('connected to ws://127.0.0.1:8089/sim');

  // Theme switching (light / dark) lives in the same dialog.
  await page.getByRole('button', { name: 'Light' }).click();
  const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (lightTheme !== 'light') throw new Error(`expected light theme, got ${lightTheme}`);
  await page.getByRole('button', { name: 'Dark' }).click();
  const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (darkTheme !== 'dark') throw new Error(`expected dark theme, got ${darkTheme}`);
  log('theme switching: light <-> dark');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Run parameters + Start live in the canvas Run dialog (per-experiment,
  // not IDE settings). The canvas is empty, so the served model runs.
  await page.locator('.canvas-run').click();
  await page.getByRole('dialog', { name: 'Run' }).waitFor();
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
    () => document.querySelector('.console-log')?.textContent?.includes('run run-'),
    undefined,
    { timeout: 30_000 },
  );
  log('run started on gateway');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Wait for the run to actually finish on the gateway (its worker is
  // single-threaded; the AI steps below must not race a leftover run).
  await page.waitForFunction(
    () => document.querySelector('.console-log')?.textContent?.includes('finished'),
    undefined,
    { timeout: 120_000 },
  );
  log('run finished on gateway');
  await page.screenshot({ path: join(OUT, '2-running.png') });

  // Modeling canvas -> generated DSL -> compile diagnostics round-trip
  // (P1-7): dropping a lone source yields an invalid model, so the gateway
  // must echo the compiler's diagnostics into the console.
  await page.getByRole('button', { name: 'Palette' }).click();
  await page.waitForSelector('.palette-item', { timeout: 5_000 });
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.palette-item')].find(
      (el) => el.querySelector('.palette-name')?.textContent === 'source',
    );
    const canvas = document.querySelector('.model-canvas');
    const rect = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    canvas.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + 200,
        clientY: rect.top + 200,
      }),
    );
  });
  await page.waitForSelector('.model-block', { timeout: 5_000 });
  // Code tabs are per file: save the canvas back to the bundle (File > Save);
  // splitModelSource rewrites main.lp to reference the scene, so opening
  // model/main.lp shows the instance line and Compile builds the merged model.
  await page.getByRole('button', { name: 'File' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5_000 }).catch(() => null),
    page
      .locator('.app-menu-dropdown .app-menu-entry', { hasText: 'Save' })
      .first()
      .click(),
  ]);
  if (download) {
    await download.cancel().catch(() => {});
  }
  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.locator('.area-left .tree-row[data-path="model/main.lp"]').click();
  await page.waitForSelector('.dsl-textarea', { timeout: 5_000 });
  const dslText = await page.locator('.dsl-textarea').inputValue();
  if (!dslText.includes('instance Flow')) {
    throw new Error('DSL file editor did not show the split main.lp');
  }
  log('canvas model saved; main.lp opened as a file tab');
  await page.getByRole('button', { name: 'Compile' }).click();
  await page.waitForFunction(
    () => document.querySelector('.console-log')?.textContent?.includes('compile failed'),
    undefined,
    { timeout: 30_000 },
  );
  const compileText = await page.locator('.console-log').textContent();
  if (!/LP\d+/.test(compileText ?? '')) {
    throw new Error('compile diagnostics missing a diagnostic code');
  }
  log('canvas DSL compiled with diagnostics echoed to the console');
  // Switch back to the canvas tab for the run model step.
  await page.locator('.area-center .tab').filter({ hasText: 'Model' }).click();
  await page.waitForSelector('.model-canvas', { timeout: 5_000 });

  // Canvas model -> Run -> live block badges (P1-7 run loop): finish the
  // mm1 shape on the canvas, run it with fast params, and assert the live
  // queue/service badges appear while the run streams.
  const dropBlock = async (kind, x, y) => {
    await page.evaluate(({ kind, x, y }) => {
      const item = [...document.querySelectorAll('.palette-item')].find(
        (el) => el.querySelector('.palette-name')?.textContent === kind,
      );
      const canvas = document.querySelector('.model-canvas');
      const rect = canvas.getBoundingClientRect();
      const dt = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      canvas.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      );
    }, { kind, x, y });
    await page.waitForTimeout(80);
  };
  await dropBlock('resource', 100, 140);
  await dropBlock('queue', 340, 260);
  await dropBlock('service', 520, 260);
  await dropBlock('sink', 700, 260);
  const portBox = async (name, port) => {
    const box = await page
      .locator(`.model-block:has(.model-block-name:text-is("${name}")) .model-port.${port}`)
      .boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const wire = async (fromName, toName) => {
    const from = await portBox(fromName, 'port-out');
    const to = await portBox(toName, 'port-in');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  };
  await wire('source', 'queue');
  await wire('queue', 'service');
  await wire('service', 'sink');
  const serviceBox = await page.locator('.model-block.kind-service').boundingBox();
  await page.mouse.click(
    serviceBox.x + serviceBox.width / 2,
    serviceBox.y + serviceBox.height / 2,
  );
  await page.waitForTimeout(120);
  await page.locator('.props-field').filter({ hasText: 'resource' }).locator('input').fill('resource');
  await page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null,
  );

  await page.locator('.canvas-run').click();
  await page.getByRole('dialog', { name: 'Run' }).waitFor();
  for (const [label, value] of [
    ['arrivals', '100'],
    ['warmup', '10'],
    ['speed', '100'],
    ['reps', '1'],
  ]) {
    await page.locator('label.field', { hasText: label }).locator('input').fill(value);
  }

  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForFunction(
    () => document.querySelector('.console-log')?.textContent?.includes('run run-'),
    undefined,
    { timeout: 20_000 },
  );
  let sawLiveBadges = false;
  for (let i = 0; i < 30; i++) {
    sawLiveBadges = await page.evaluate(
      () => document.querySelectorAll('.model-block-badge, .model-block-status').length > 0,
    );
    if (sawLiveBadges) break;
    await page.waitForTimeout(100);
  }
  if (!sawLiveBadges) {
    throw new Error('canvas did not show live run badges');
  }
  await page.waitForFunction(
    () => document.querySelector('.console-log')?.textContent?.includes('finished'),
    undefined,
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  log('canvas model ran with live block badges');

  // Strict partitioning (node-scene step 3): the root canvas shows only
  // model-level elements (resource + process container); stages stay inside
  // their container and only appear when drilling into it.
  await page.locator('.pill-root').click();
  await page.waitForTimeout(150);
  const rootKinds = await page.evaluate(() =>
    [...document.querySelectorAll('.model-canvas .model-block')].map((el) => el.className),
  );
  if (!rootKinds.some((cls) => cls.includes('kind-process'))) {
    throw new Error('root canvas missing the process container Node');
  }
  if (rootKinds.some((cls) => cls.includes('kind-source') || cls.includes('kind-queue'))) {
    throw new Error('root canvas leaked process stages');
  }
  await page.locator('.model-block.kind-process').dblclick();
  await page.waitForSelector('.model-block.kind-source', { timeout: 5_000 });
  log('canvas strict partition: root hides stages, container drills in');

  // Parallel container tabs (node-scene): drilling in opens a Flow tab next
  // to the Model tab; switching tabs changes the canvas without a trip back
  // to the root, and closing the container tab returns to the root.
  const flowTab = page.locator('.area-center .tab').filter({ hasText: 'Flow' });
  if ((await flowTab.count()) !== 1) {
    throw new Error('container view did not open as a center tab');
  }
  await page.locator('.area-center .tab').filter({ hasText: 'Model' }).click();
  await page.waitForSelector('.model-block.kind-process', { timeout: 5_000 });
  if (await page.locator('.model-block.kind-source').count() !== 0) {
    throw new Error('Model tab did not show the root canvas');
  }
  await flowTab.click();
  await page.waitForSelector('.model-block.kind-source', { timeout: 5_000 });
  await flowTab.locator('.tab-x').click();
  await page.waitForSelector('.model-block.kind-process', { timeout: 5_000 });
  if ((await page.locator('.area-center .tab').filter({ hasText: 'Flow' }).count()) !== 0) {
    throw new Error('closing the container tab did not remove it');
  }
  log('canvas parallel tabs: switch + close container views');

  // AI panel (right): generate / optimize / explain / trajectory.
  await page.locator('.tab-label').filter({ hasText: /^AI$/ }).click();
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
  await page.getByRole('button', { name: 'Load to canvas' }).click();
  await page.waitForTimeout(300);
  const canvasBlocks = await page.locator('.model-block').count();
  if (canvasBlocks < 2) {
    throw new Error('AI model did not load into the modeling canvas');
  }
  log('AI model loaded into the modeling canvas');

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

  // View menu: the trailing check mark means "panel open", and clicking an
  // open panel collapses it (AI toggles the right area).
  await page.getByRole('button', { name: 'View' }).click();
  const aiChecked = await page
    .locator('.app-menu-dropdown .app-menu-entry', { hasText: 'AI' })
    .evaluate((el) => el.querySelector('.app-menu-entry-check') !== null);
  if (!aiChecked) {
    throw new Error('View > AI should be checked while the panel is open');
  }
  await page.locator('.app-menu-dropdown .app-menu-entry', { hasText: 'AI' }).click();
  await page.waitForFunction(
    () => document.querySelector('.area-right')?.classList.contains('collapsed') ?? false,
    undefined,
    { timeout: 5_000 },
  );
  await page.getByRole('button', { name: 'View' }).click();
  await page.locator('.app-menu-dropdown .app-menu-entry', { hasText: 'AI' }).click();
  await page.waitForSelector('.area-right:not(.collapsed)', { timeout: 5_000 });
  log('View menu toggles open panels via the check mark');

  // File > Close: the AI load left unsaved changes, so Close asks first and
  // Don't Save returns to the empty center.
  await page.getByRole('button', { name: 'File' }).click();
  await page.locator('.app-menu-dropdown .app-menu-entry', { hasText: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Close project' }).waitFor();
  await page.getByRole('button', { name: "Don't Save" }).click();
  await page.waitForSelector('.center-empty', { timeout: 5_000 });
  log('File > Close with unsaved changes asks, then returns to the empty state');

  // A pristine project closes without a prompt.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog', { name: 'New Project' }).waitFor();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'File' }).click();
  await page.locator('.app-menu-dropdown .app-menu-entry', { hasText: 'Close' }).click();
  await page.waitForSelector('.center-empty', { timeout: 5_000 });
  log('pristine project closes without a prompt');

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
