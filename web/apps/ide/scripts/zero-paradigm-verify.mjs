// Zero-paradigm gate (Phase 2, plan §16): the Shell must "build, start and
// edit plain files" with ZERO paradigm plugins. This script boots the Vite
// dev server with VITE_ZERO_PLUGINS=1 (empty plugin discovery table) and
// drives the app in a headless browser:
//
//   1. The shell renders: activity bar, tab bars, status bar, welcome/empty
//      center - no blank page, no console errors.
//   2. A plain (non-paradigm) file can be created and edited in the editor.
//   3. The Problems/Console bottom panels render without contributed
//      problem sources.
//
// The full-paradigm regression path remains scripts/browser-verify.mjs.
//
// Usage: node web/apps/ide/scripts/zero-paradigm-verify.mjs

import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const OUT = join(here, '..', '..', '..', '..', '.verify', 'out');
mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log('[zero-plugin]', ...args);

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
  console.error('[zero-plugin] no Chrome/Chromium/Edge executable found');
  process.exit(1);
}

// Boot the dev server with the zero-plugin flag. Vite reads VITE_* vars at
// transform time, so the flag must be present in the server environment.
const ideRoot = join(here, '..');
const viteEntry = join(ideRoot, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteEntry)) {
  console.error(`[zero-plugin] vite entrypoint not found: ${viteEntry}`);
  process.exit(1);
}
process.env.VITE_ZERO_PLUGINS = '1';
const { build: buildVite } = await import('vite');
await buildVite({
  root: ideRoot,
  logLevel: 'warn',
  build: {
    outDir: join(OUT, 'zero-paradigm-dist'),
    emptyOutDir: true,
  },
});
log('production build completed with zero plugins');
const server = spawn(process.execPath, [viteEntry, '--port', '5199', '--strictPort'], {
  cwd: ideRoot,
  env: { ...process.env, VITE_ZERO_PLUGINS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverOutput = [];
server.stdout.on('data', (chunk) => {
  serverOutput.push(String(chunk));
  if (serverOutput.join('').length < 4000) process.stdout.write(`[vite] ${chunk}`);
});
server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const res = await fetch('http://localhost:5199/');
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('dev server did not come up on http://localhost:5199');
};

let browser;
try {
  await waitForServer();
  log('dev server up (VITE_ZERO_PLUGINS=1)');

  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  // vite dev keeps a persistent HMR websocket open, so 'networkidle' never
  // settles and stalls the gate. Wait for DOM content instead; the explicit
  // .app / .tab-bar / .status-bar selector waits below are the real readiness
  // checks for the zero-paradigm shell.
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });

  // 1. The shell skeleton renders.
  await page.waitForSelector('.app', { timeout: 15_000 });
  await page.waitForSelector('.tab-bar', { timeout: 15_000 });
  await page.waitForSelector('.status-bar', { timeout: 15_000 });
  log('shell skeleton rendered (app, tab bars, status bar)');

  // Runtime truth, not just visual smoke: importing the builtin entrypoint
  // modules must not register anything unless PluginHost activates them.
  const registries = await page.evaluate(async () => {
    const [documents, diagnostics, outlines, palette, problems, panels] = await Promise.all([
      import('/src/workbench/documentTypes.ts'),
      import('/src/workbench/diagnostics.ts'),
      import('/src/workbench/outline.ts'),
      import('/src/workbench/palette.ts'),
      import('/src/workbench/problems.ts'),
      import('/src/layout/panels.tsx'),
    ]);
    return {
      documents: documents.DOCUMENT_CONTRIBUTIONS.list().map((entry) => entry.id),
      diagnostics: diagnostics.DIAGNOSTIC_PROVIDERS.forDocumentTypes('dsl', 'sysml').map(
        (entry) => entry.id,
      ),
      outlines: outlines.OUTLINE_CONTRIBUTIONS.list().map((entry) => entry.id),
      palettes: palette.PALETTE_CONTRIBUTIONS.list().map((entry) => entry.id),
      problemSources: problems.contributedProblemStores().map((entry) => entry.source.id),
      hasSysmlPanel: panels.PANELS.sysml !== undefined,
    };
  });
  if (
    registries.documents.length > 0 ||
    registries.diagnostics.length > 0 ||
    registries.outlines.length > 0 ||
    registries.palettes.length > 0 ||
    registries.problemSources.length > 0 ||
    registries.hasSysmlPanel
  ) {
    throw new Error(`zero-plugin registries are not empty: ${JSON.stringify(registries)}`);
  }
  log('all paradigm contribution registries are empty');

  // 2. Bottom panels (Problems/Console) render with no contributed sources.
  const bottomTabs = await page.evaluate(() =>
    [...document.querySelectorAll('.area-bottom .tab .tab-label')].map((l) => l.textContent),
  );
  if (!bottomTabs.includes('Problems') || !bottomTabs.includes('Console')) {
    throw new Error(`bottom panels missing: ${bottomTabs.join(', ')}`);
  }
  await page.locator('.area-bottom .tab', { hasText: 'Problems' }).click();
  await page.waitForFunction(
    () => document.querySelector('.area-bottom')?.textContent?.includes('No problems detected.'),
    undefined,
    { timeout: 5_000 },
  );
  log('Problems panel renders empty without contributed problem sources');

  // 3. The Properties tab exists and its host renders the default editor
  //    (no paradigm contributed editors registered).
  const rightTabs = await page.evaluate(() =>
    [...document.querySelectorAll('.area-right .tab .tab-label')].map((l) => l.textContent),
  );
  if (!rightTabs.includes('Properties')) {
    throw new Error(`right panels missing Properties: ${rightTabs.join(', ')}`);
  }
  log('Properties host present with no paradigm editors');

  // 4. A plain text file can be opened and edited through the workspace
  //    file store (the generic editor is contribution-agnostic). Drive the
  //    real UI: create a workspace text file via the uiStore seam and type
  //    into the editor textarea.
  await page.evaluate(() => {
    // The workspace file facility is the shell's plain-file surface (no
    // paradigm involved). Create an in-memory plain file and open it.
    return import('/src/state/uiStore.ts').then(({ useUiStore }) => {
      useUiStore.getState().openDiskFile?.('notes/readme.txt', '# plain notes\n');
    });
  });
  // Generic text editor: the workspace editor handles unregistered files.
  await page.waitForSelector('.dsl-textarea', { timeout: 10_000 });
  const textValue = await page.locator('.dsl-textarea').inputValue();
  if (!textValue.includes('plain notes')) {
    throw new Error('plain file did not open in the editor');
  }
  await page.locator('.dsl-textarea').fill('# plain notes\nedited under zero plugins\n');
  const edited = await page.locator('.dsl-textarea').inputValue();
  if (!edited.includes('edited under zero plugins')) {
    throw new Error('plain file could not be edited');
  }
  log('plain file opened and edited through the generic editor');

  await page.screenshot({ path: join(OUT, 'zero-paradigm-shell.png') });

  // Any console error fails the gate (blank-page class regressions).
  const fatal = consoleErrors.filter(
    (message) => !message.includes('favicon') && !message.includes('/api/'),
  );
  if (fatal.length > 0) {
    throw new Error(`console errors under zero plugins: ${fatal.join(' | ')}`);
  }

  log('PASS: zero-paradigm shell builds, starts and edits plain files');
} catch (err) {
  if (browser) {
    await browser
      .newPage()
      .then((p) => p.screenshot({ path: join(OUT, 'zero-paradigm-failure.png') }))
      .catch(() => {});
  }
  console.error('[zero-plugin] FAIL:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      once(server, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
