// Paradigm lifecycle gate (Phase 2, de-paradigmization boundary): the shell's
// paradigm surfaces must follow PLUGIN lifecycle, not static imports. This
// gate runs the DEFAULT build (all builtin paradigms), then
//   1. verifies the full contribution set is present (contrast to the
//      zero-paradigm gate),
//   2. stops ONE paradigm builtin at runtime (`PluginHost.stop`) and verifies
//      only that paradigm's contributions disappear while the others remain,
//   3. restarts the host with a single-builtin discovery table and verifies
//      the contribution set follows the table exactly (host-level uninstall
//      semantics).
//
// This defines the boundary the Palette/panel de-paradigmization works
// against: no contribution may outlive its plugin, and no contribution may
// appear without its plugin being in the discovery table.
//
// Usage: node web/apps/ide/scripts/paradigm-lifecycle-verify.mjs

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

const log = (...args) => console.log('[paradigm-lifecycle]', ...args);

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
  console.error('[paradigm-lifecycle] no Chrome/Chromium/Edge executable found');
  process.exit(1);
}

const ideRoot = join(here, '..');
const viteEntry = join(ideRoot, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteEntry)) {
  console.error(`[paradigm-lifecycle] vite entrypoint not found: ${viteEntry}`);
  process.exit(1);
}

// Default environment: every builtin paradigm is bundled and activated.
const server = spawn(process.execPath, [viteEntry, '--port', '5198', '--strictPort'], {
  cwd: ideRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const res = await fetch('http://localhost:5198/');
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('dev server did not come up on http://localhost:5198');
};

/** Reads the workbench contribution registries from the running shell. */
async function readRegistries(page) {
  return page.evaluate(async () => {
    const [documents, palette, panels] = await Promise.all([
      import('/src/workbench/documentTypes.ts'),
      import('/src/workbench/palette.ts'),
      import('/src/layout/panels.tsx'),
    ]);
    return {
      documents: documents.DOCUMENT_CONTRIBUTIONS.list().map((entry) => entry.id),
      palettes: palette.PALETTE_CONTRIBUTIONS.list().map((entry) => entry.id),
      hasSysmlPanel: panels.PANELS.sysml !== undefined,
    };
  });
}

let browser;
try {
  await waitForServer();
  log('dev server up (default: all builtin paradigms)');

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
  await page.goto('http://localhost:5198/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app', { timeout: 15_000 });

  // Wait for the plugin host to finish activating the builtin paradigms.
  await page.waitForFunction(
    async () => {
      const hostModule = await import('/src/plugins/host.ts');
      return hostModule.idePluginHost()?.phaseValue === 'active';
    },
    undefined,
    { timeout: 15_000, polling: 200 },
  );

  // 1. Full-paradigm baseline: both DES and SysML contributions present.
  const baseline = await readRegistries(page);
  if (!baseline.documents.includes('dsl') || !baseline.documents.includes('sysml')) {
    throw new Error(`full-paradigm documents missing: ${JSON.stringify(baseline)}`);
  }
  if (!baseline.palettes.includes('logicpilot.process')) {
    throw new Error(`process palette missing: ${JSON.stringify(baseline)}`);
  }
  if (!baseline.palettes.includes('sysml.visual-subset')) {
    throw new Error(`sysml palette missing: ${JSON.stringify(baseline)}`);
  }
  if (!baseline.hasSysmlPanel) {
    throw new Error('sysml panel missing in full-paradigm mode');
  }
  log('full-paradigm baseline: dsl + sysml documents, process + sysml palettes, sysml panel');

  // 1b. The palette follows the ACTIVE document, not the discovery table:
  //     a .lp file offers the process library and hides SysML, a .sysml file
  //     the opposite, a plain file offers nothing (plan §5 PaletteProvider
  //     contextual conditions).
  const paletteTabs = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.palette-library-tab')].map((tab) => tab.textContent ?? ''),
    );
  const openFile = (path, content) =>
    page.evaluate(
      async ({ path, content }) =>
        (await import('/src/state/uiStore.ts')).useUiStore.getState().openDiskFile?.(path, content),
      { path, content },
    );
  const waitForTabs = (expected, absent) =>
    page.waitForFunction(
      ({ expected, absent }) => {
        const tabs = [...document.querySelectorAll('.palette-library-tab')].map(
          (tab) => tab.textContent ?? '',
        );
        return (
          expected.every((name) => tabs.includes(name)) &&
          absent.every((name) => !tabs.includes(name))
        );
      },
      { expected, absent },
      { timeout: 10_000 },
    );

  await openFile('models/mm1.lp', 'model MM1 {}\n');
  await waitForTabs(['process'], ['SysML']);
  log('.lp document: palette offers process, hides SysML');

  await openFile('architecture/diagram.sysml', 'package P {}\n');
  await waitForTabs(['SysML'], ['process']);
  log('.sysml document: palette offers SysML, hides process');

  await openFile('notes/readme.txt', '# plain notes\n');
  await page.waitForSelector('.palette-empty', { timeout: 10_000, state: 'attached' });
  const emptyText = await page.$eval('.palette-empty', (node) => node.textContent ?? '');
  if (!/No element library/.test(emptyText)) {
    throw new Error('palette empty state text is wrong: ' + emptyText);
  }
  log('plain file: palette shows the empty state');

  // 2. Stop ONE paradigm at runtime; only its contributions may disappear.
  const afterSysmlStop = await page.evaluate(async () => {
    const hostModule = await import('/src/plugins/host.ts');
    const host = hostModule.idePluginHost();
    if (!host) throw new Error('plugin host is not running');
    await host.stop('logicpilot.sysml');
    const [documents, palette, panels] = await Promise.all([
      import('/src/workbench/documentTypes.ts'),
      import('/src/workbench/palette.ts'),
      import('/src/layout/panels.tsx'),
    ]);
    return {
      documents: documents.DOCUMENT_CONTRIBUTIONS.list().map((entry) => entry.id),
      palettes: palette.PALETTE_CONTRIBUTIONS.list().map((entry) => entry.id),
      hasSysmlPanel: panels.PANELS.sysml !== undefined,
    };
  });
  if (afterSysmlStop.documents.includes('sysml')) {
    throw new Error('sysml document type outlived its plugin stop');
  }
  if (afterSysmlStop.palettes.includes('sysml.visual-subset')) {
    throw new Error('sysml palette outlived its plugin stop');
  }
  if (afterSysmlStop.hasSysmlPanel) {
    throw new Error('sysml panel outlived its plugin stop');
  }
  if (!afterSysmlStop.documents.includes('dsl')) {
    throw new Error('dsl document type was lost when sysml stopped');
  }
  if (!afterSysmlStop.palettes.includes('logicpilot.process')) {
    throw new Error('process palette was lost when sysml stopped');
  }
  log('stopping logicpilot.sysml revoked exactly its contributions; process/DES untouched');

  // The shell must stay usable: palette host still renders the process library.
  await page.waitForSelector('.palette, .palette-panel, [class*="palette"]', { timeout: 5_000 });
  log('palette host still renders after the sysml stop');

  // 3. Host restart with a single-builtin discovery table: the contribution
  //    set must follow the table exactly (host-level uninstall semantics).
  const subset = await page.evaluate(async () => {
    const hostModule = await import('/src/plugins/host.ts');
    await hostModule.stopIdePluginHost();
    const manifestJson = (await import('/src/plugins/builtin/sysml/plugin.json')).default;
    const load = async () =>
      (await import('/src/plugins/builtin/sysml/activate')).activateSysmlPlugin();
    await hostModule.startIdePluginHost({ builtins: [{ manifestJson, load }] });
    const [documents, palette, panels] = await Promise.all([
      import('/src/workbench/documentTypes.ts'),
      import('/src/workbench/palette.ts'),
      import('/src/layout/panels.tsx'),
    ]);
    return {
      documents: documents.DOCUMENT_CONTRIBUTIONS.list().map((entry) => entry.id),
      palettes: palette.PALETTE_CONTRIBUTIONS.list().map((entry) => entry.id),
      hasSysmlPanel: panels.PANELS.sysml !== undefined,
    };
  });
  if (!subset.documents.includes('sysml')) {
    throw new Error(`sysml-only restart lost the sysml document: ${JSON.stringify(subset)}`);
  }
  if (!subset.palettes.includes('sysml.visual-subset') || !subset.hasSysmlPanel) {
    throw new Error(`sysml-only restart lost sysml surfaces: ${JSON.stringify(subset)}`);
  }
  if (subset.documents.includes('dsl')) {
    throw new Error('dsl document appeared without its plugin in the discovery table');
  }
  if (subset.palettes.some((id) => id.startsWith('logicpilot.'))) {
    throw new Error(`model palettes appeared without the DES plugin: ${JSON.stringify(subset)}`);
  }
  log('sysml-only restart: contributions follow the discovery table exactly');

  await page.screenshot({ path: join(OUT, 'paradigm-lifecycle.png') });

  const fatal = consoleErrors.filter(
    (message) => !message.includes('favicon') && !message.includes('/api/'),
  );
  if (fatal.length > 0) {
    throw new Error(`console errors during paradigm lifecycle: ${fatal.join(' | ')}`);
  }

  log('PASS: paradigm surfaces follow plugin lifecycle and the discovery table');
} catch (err) {
  if (browser) {
    await browser
      .newPage()
      .then((p) => p.screenshot({ path: join(OUT, 'paradigm-lifecycle-failure.png') }))
      .catch(() => {});
  }
  console.error('[paradigm-lifecycle] FAIL:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise((r) => setTimeout(r, 5_000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
