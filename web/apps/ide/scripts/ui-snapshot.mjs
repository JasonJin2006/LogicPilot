// UI snapshot probe: drives the IDE through a system browser, opens a project
// the way a user does, and captures the chrome for visual review.
//
// A lightweight sibling of browser-verify.mjs: it needs no lp-server gateway
// and asserts nothing about simulation, so it is the right tool for reviewing
// a layout / theme / chrome change by eye.
//
// Prereqs: a dev server (`pnpm dev`) or a preview server (`pnpm build` then
// `pnpm exec vite preview`), plus a system Chrome/Chromium/Edge.
//
// Usage: node web/apps/ide/scripts/ui-snapshot.mjs [--url=…] [--out=…] [--scheme=dark|light]
//        [--runtime]
//        (default url http://localhost:5173, default out <repo>/.verify/ui)
//        Note: Vite binds localhost (often IPv6 ::1 only), so prefer
//        `localhost` over `127.0.0.1` here.
//
// `--runtime` additionally boots the real Node plugin runtime (ADR-0134:
// generated runtime packages -> lockfile -> NodePluginRuntime) and serves the
// execution targets it registered on the endpoint the IDE calls at startup, so
// the backend slot is checked against manifest-declared targets rather than
// injected ones. It stays opt-in because it costs a package build and is the
// only part of this probe that touches Node-side runtime state.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const repoRoot = join(here, '..', '..', '..', '..');

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const url = arg('url', 'http://localhost:5173');
const scheme = arg('scheme', 'light') === 'light' ? 'light' : 'dark';
// Resolved once, before any chdir: a relative --out would otherwise land in
// two different places (mkdir here, screenshots after the runtime boot).
const outDir = resolve(arg('out', join(repoRoot, '.verify', 'ui')));
const withRuntime = process.argv.includes('--runtime');
mkdirSync(outDir, { recursive: true });

const CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('[snapshot] no Chrome/Chromium/Edge executable found');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  colorScheme: scheme,
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

const shot = async (name) => {
  const path = join(outDir, `${scheme}-${name}.png`);
  await page.screenshot({ path });
  console.log(`[snapshot] ${name} -> ${path}`);
};

/** Chrome geometry + chrome text, so a review can cite rendered values rather
 *  than eyeball a downscaled image. */
const probe = () =>
  page.evaluate(() => {
    const pick = (selector, ...props) => {
      const el = document.querySelector(selector);
      if (el === null) return `MISSING ${selector}`;
      const cs = getComputedStyle(el);
      return props.map((p) => `${p}=${cs[p]}`).join(' ');
    };
    const labels = (selector) =>
      [...document.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');
    return {
      theme: document.documentElement.dataset.theme,
      topBar: pick('.top-bar', 'backgroundColor', 'height'),
      activityBar: pick('.activity-bar', 'backgroundColor', 'width'),
      statusBar: pick('.status-bar', 'backgroundColor', 'minHeight'),
      activity: [...document.querySelectorAll('.activity-bar .activity-item')].map((el) =>
        el.getAttribute('aria-label'),
      ),
      sections: labels('.panel-section .panel-title'),
      // Left-bar tree rows with their classes: the class names the row's role
      // (tree-root = project container, tree-folder = model, tree-file =
      // element), which is what tells two identical labels apart. The Explorer
      // draws the project root; the outline starts at the model row.
      leftTree: [...document.querySelectorAll('.area-left .tree-row')].map(
        (el) => `${el.className.replace('tree-row', '').trim()} :: ${el.textContent?.trim() ?? ''}`,
      ),
      tabs: labels('.area-center .tab'),
      breadcrumb: labels('.breadcrumb-bar .breadcrumb-label'),
      // Status bar per segment: the left group reports the workspace, the
      // right one the document in front. aria-label wins over text where a
      // slot is an icon pair (the error/warning counters).
      status: [...document.querySelectorAll('.status-bar .status-group')].map((group) =>
        [...group.children].map((el) => {
          const role = String(el.className)
            .replace('status-item', '')
            .replace('conn-dot', '')
            .trim();
          const label = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
          return `${role} ${label}`.trim();
        }),
      ),
    };
  });

// Node-side runtime state, only populated by --runtime and torn down in
// finally so a crashed run cannot leave a worker or a scratch tree behind.
let runtimeRoot = null;
let stopRuntime = null;
let runtimeTargetIds = [];

// The finally block cannot be relied on: a worker that dies with an uncaught
// error takes the process down straight from an event handler, and the awaited
// cleanup never resumes. Removing the scratch tree on exit is synchronous, so
// it survives that path.
process.on('exit', () => {
  if (runtimeRoot === null) return;
  try {
    rmSync(runtimeRoot, { recursive: true, force: true });
  } catch {
    // best effort: the process is already on its way out
  }
});

try {
  if (withRuntime) {
    // The runtime's module loader resolves plugin entrypoints through a worker
    // that inherits this process's working directory, so a boot from the
    // package directory (where `pnpm run` puts us) dies with
    // `DynamicEsmLoaderError: handler-failed`. Re-enter the repository root,
    // which is the working directory the app server boots in.
    process.chdir(repoRoot);
    // buildRuntimePlugins refuses to write anywhere but <repo>/build, which is
    // gitignored, so the scratch tree belongs there.
    mkdirSync(join(repoRoot, 'build'), { recursive: true });
    runtimeRoot = mkdtempSync(join(repoRoot, 'build', 'ui-snapshot-runtime-'));
    const { buildRuntimePlugins } = await import('../../../../scripts/build-runtime-plugins.mjs');
    const {
      startNodePluginRuntime,
      stopNodePluginRuntime,
      getNodeExecutionTargetRegistry,
      getNodeExecutionService,
    } = await import('./plugin-catalog-bridge.mjs');
    const packageRoot = join(runtimeRoot, 'plugins');
    const storeRoot = join(runtimeRoot, 'store');
    buildRuntimePlugins(packageRoot, storeRoot);
    process.env.LOGICPILOT_ENABLE_NODE_PLUGINS = '1';
    process.env.LOGICPILOT_NODE_PLUGIN_TRUST = 't4';
    process.env.LOGICPILOT_PLUGIN_STORE_ROOT = storeRoot;
    process.env.LOGICPILOT_PLUGIN_ROOTS = JSON.stringify({
      system: [packageRoot],
      user: [],
      workspace: [],
    });
    process.env.LOGICPILOT_EXECUTION_RUN_STORE_ROOT = join(runtimeRoot, 'runs');
    await startNodePluginRuntime();
    stopRuntime = stopNodePluginRuntime;
    const targets = [...(getNodeExecutionTargetRegistry()?.list() ?? [])];
    if (targets.length === 0) throw new Error('the node runtime registered no execution targets');
    runtimeTargetIds = targets.map((target) => target.id);
    console.log(
      `[snapshot] node runtime up, ${targets.length} target(s): ${runtimeTargetIds.join(', ')}`,
    );
    // App.tsx fetches this on mount and Vite proxies no /api route, so for this
    // one endpoint the probe stands in for the app server - serving the real
    // registry, which is exactly what the server would serialize.
    await page.route('**/api/execution/targets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ targets }),
      }),
    );
    // The run endpoint, backed by the real ExecutionService in this process:
    // the request the IDE posts is handed to the service and the finished
    // session (read back from its run store) is what the IDE receives. So the
    // run is real - real kernel, real evidence - and only the transport stands
    // in for the app server.
    const service = getNodeExecutionService();
    if (service === null) throw new Error('the node runtime exposed no execution service');
    await page.route('**/api/execution/runs', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 405, body: '' });
        return;
      }
      const { action, ...request } = route.request().postDataJSON();
      const started = await service.start(request);
      const result = await service.wait(started.runId);
      console.log(
        `[snapshot] real run ${started.runId} on ${request.targetId}: ${result.run.status}` +
          (result.evidence?.runtimeKind ? ` (${result.evidence.runtimeKind} evidence)` : ''),
      );
      // The session the store kept is the terminal one; fall back to the
      // handle the service returned if the store has nothing yet.
      const persisted = JSON.parse(
        readFileSync(join(runtimeRoot, 'runs', 'execution-sessions.json'), 'utf8'),
      );
      const session = persisted.sessions.find((item) => item.runId === started.runId) ?? started;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session }),
      });
    });
  }

  console.log(`[snapshot] loading ${url} (${scheme} scheme)`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.area-center', { timeout: 20_000 });
  await page.waitForTimeout(600);
  await shot('00-startup');

  // Open a project the way a user does: Help > Welcome > New project. This is
  // the browser-only path browser-verify.mjs uses, so no Tauri shell is needed.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.locator('.app-menu-dropdown .app-menu-entry', { hasText: 'Welcome' }).click();
  await page.waitForSelector('.center-empty', { timeout: 10_000 });
  await page.locator('.area-center .tab').filter({ hasText: 'Welcome' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('dialog', { name: 'New Project' }).waitFor();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('.model-canvas', { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  await shot('01-project');
  console.log('[snapshot] probe', JSON.stringify(await probe(), null, 2));

  // Open a document too, so the editor chrome (tab strip + breadcrumb) is
  // exercised. Best effort: a fresh project may not expose a file row yet.
  const fileRow = page.locator('.area-left .tree-file').first();
  if ((await fileRow.count()) > 0) {
    await fileRow.click();
    await page.waitForTimeout(1_000);
    await shot('02-document');
    console.log('[snapshot] probe', JSON.stringify(await probe(), null, 2));
  } else {
    console.log('[snapshot] no file row in the explorer; skipped the document shot');
  }

  // The paradigm slot reads the model's OWN `use <pack>` declaration, so
  // declaring one through the editor must make the shell echo it back. This is
  // the check that the slot is driven by the model rather than by chrome.
  const editor = page.locator('.dsl-textarea');
  if ((await editor.count()) > 0) {
    await editor.fill('model Untitled {\n  use process\n}\n');
    await page.waitForFunction(
      () => document.querySelector('.status-bar')?.textContent?.includes('Paradigm: process'),
      undefined,
      { timeout: 8_000 },
    );
    console.log('[snapshot] the model `use` declaration surfaced in the status bar');
    await shot('03-paradigm-slot');
    console.log('[snapshot] probe', JSON.stringify(await probe(), null, 2));
  } else {
    console.log('[snapshot] no text editor on screen; skipped the paradigm slot check');
  }

  // Status-bar problem counters: contribute through the seam a plugin would
  // use, so this exercises the real aggregation -> render -> click path
  // rather than a stubbed bar. An empty project reports no problems at all,
  // which is why the counters are hidden in the shots above.
  await page.evaluate(async () => {
    const { registerProblemSource } = await import('/src/workbench/problems.ts');
    globalThis.__probeDisposeProblems = registerProblemSource({
      id: 'snapshot-probe',
      read: () => [
        { id: 'probe:e', origin: 'probe', code: 'PB1', severity: 'error', message: 'probe error' },
        {
          id: 'probe:w',
          origin: 'probe',
          code: 'PB2',
          severity: 'warning',
          message: 'probe warning',
        },
      ],
      subscribe: () => () => {},
    });
  });
  await page.waitForTimeout(300);
  await shot('04-problem-counters');
  const counters = await page.locator('.status-bar button.status-item').getAttribute('aria-label');
  console.log(`[snapshot] status-bar counters: ${counters}`);
  await page.locator('.status-bar button.status-item').click();
  await page.waitForFunction(
    () => document.querySelector('.area-bottom')?.textContent?.includes('probe error'),
    undefined,
    { timeout: 5_000 },
  );
  console.log('[snapshot] counter click revealed the Problems panel');
  await page.evaluate(() => globalThis.__probeDisposeProblems?.());
  await page.waitForTimeout(200);
  await shot('05-problems-cleared');
  const cleared = await page.locator('.status-bar button.status-item').count();
  console.log(`[snapshot] counters after disposal: ${cleared}`);

  // Backend slot. With --runtime the real chain is exercised end to end:
  // generated runtime package -> manifest executionTargets -> NodePluginRuntime
  // registry -> the endpoint App.tsx calls -> status bar. Without it a
  // browser-only run has no app server at all, so the slot's wiring is checked
  // by publishing one target through the same store the startup call writes to.
  if (withRuntime) {
    const expected =
      runtimeTargetIds.length > 1
        ? `${runtimeTargetIds.length} targets`
        : (runtimeTargetIds[0] ?? '');
    await page.waitForFunction(
      (label) =>
        document.querySelector('.status-bar')?.textContent?.includes(`Backend: ${label}`),
      expected,
      { timeout: 8_000 },
    );
    console.log(`[snapshot] real execution targets reached the status bar: Backend: ${expected}`);
    await shot('06-backend-runtime');
  } else {
    await page.evaluate(async () => {
      const { useExecutionStore } = await import('/src/state/executionStore.ts');
      useExecutionStore.getState().setTargets([
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'probe.synthetic.target',
          artifactRef: { schema: 'logicpilot.artifact-ref/v1', contractVersion: 1, id: 'probe' },
          runtime: { kind: 'native' },
        },
      ]);
    });
    await page.waitForFunction(
      () =>
        document.querySelector('.status-bar')?.textContent?.includes('Backend: probe.synthetic.target'),
      undefined,
      { timeout: 5_000 },
    );
    console.log('[snapshot] the published execution target surfaced in the status bar');
    await shot('06-backend-slot');
  }
  console.log('[snapshot] probe', JSON.stringify(await probe(), null, 2));

  // A real run binds the slot to one backend instead of a count. The IDE's Run
  // button cannot be driven from here: its native branch requires the
  // `logicpilot.native.session` target, which only exists when the desktop
  // session host is enabled (LOGICPILOT_ENABLE_NATIVE_SESSION_HOST plus
  // LOGICPILOT_SESSION_HOST). So the request goes through the IDE's real
  // client, and the run behind it is real (kernel, evidence, run store).
  if (withRuntime) {
    const dsl = readFileSync(join(repoRoot, 'examples', 'mm1.lp'), 'utf8');
    const started = await page.evaluate(async (source) => {
      const { createExecutionClient } = await import('/src/client/executionClient.ts');
      const { useExecutionStore } = await import('/src/state/executionStore.ts');
      const session = await createExecutionClient().start({
        requestId: 'ui-snapshot-run',
        targetId: 'logicpilot.process.runtime',
        budget: { maxWallMs: 60_000 },
        inputs: { paradigm: 'process', dsl: source },
      });
      useExecutionStore.getState().begin(session);
      return { runId: session.runId, targetId: session.targetId, status: session.status };
    }, dsl);
    console.log(
      `[snapshot] session ${started.runId} bound to ${started.targetId} (status ${started.status})`,
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('.status-bar')
          ?.textContent?.includes('Backend: logicpilot.process.runtime'),
      undefined,
      { timeout: 8_000 },
    );
    console.log('[snapshot] the run-bound backend replaced the target count');
    await shot('07-backend-bound');
    // And back again: the slot follows the store rather than a value captured
    // at boot.
    await page.evaluate(async () => {
      const { useExecutionStore } = await import('/src/state/executionStore.ts');
      useExecutionStore.getState().reset();
    });
    await page.waitForTimeout(200);
    const reverted = await page.locator('.status-bar .status-group-left').innerText();
    console.log(`[snapshot] after reset: ${reverted.replace(/\s+/g, ' ').trim()}`);
  }

  // Run dialog ownership split (docs/specs/dsl-freeze.md section 3): the
  // model's `experiment` block owns seed and replications; the shell owns this
  // run's warmup and termination. Writing an experiment into the editor must
  // make the dialog show the model's seed while leaving the shell's own
  // warmup alone - the check that the shell no longer duplicates the model's
  // half of the settings.
  if ((await editor.count()) > 0) {
    await editor.fill(
      [
        'model Untitled {',
        '  use process',
        '',
        '  experiment Baseline {',
        '    type = simulation',
        '    replications = 4',
        '    seed = 7',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const { useRunStore } = await import('/src/state/runStore.ts');
      const { useUiStore } = await import('/src/state/uiStore.ts');
      // A deliberately different shell value, to prove the model wins for the
      // fields it owns and does not touch the run-level ones.
      useRunStore.getState().setRunOptions({ seed: 99, warmup: 1234 });
      useUiStore.getState().openRunDialog();
    });
    await page.waitForSelector('.dialog-card[aria-label="Run"]', { timeout: 5_000 });
    await page.waitForTimeout(300);
    const groups = await page.evaluate(() => {
      const card = document.querySelector('.dialog-card[aria-label="Run"]');
      return [...(card?.querySelectorAll('.run-field-group') ?? [])].map((group) => {
        const values = {};
        for (const field of group.querySelectorAll('label.field')) {
          const name = field.querySelector('span')?.textContent ?? '';
          values[name] = field.querySelector('input, select')?.value ?? '';
        }
        return {
          label: group.querySelector('.run-field-group-label')?.textContent ?? '',
          values,
        };
      });
    });
    console.log('[snapshot] run dialog groups', JSON.stringify(groups));
    const modelGroup = groups[0]?.values ?? {};
    const runGroup = groups[1]?.values ?? {};
    console.log(
      `[snapshot] model-owned seed: ${modelGroup['seed']} (expect 7 from the experiment), ` +
        `reps: ${modelGroup['reps']} (expect 4), run-level warmup: ${runGroup['warmup']} (expect 1234 from the shell)`,
    );
    await shot('08-run-dialog-ownership');

    // The precision metric vocabulary comes from the pack, not the shell. The
    // option ORDER is the pack's declaration order (Wq first), which the old
    // hardcoded shell list (throughput first) could not have produced - so this
    // separates "read from the pack" from "coincidentally the same set".
    //
    // The dialog unmounts when closed, so reopening it after setting the store
    // re-initialises the draft fields from `RunOptions`. The close and the
    // reopen must be separate React commits, otherwise the batched update looks
    // like no change at all and the old draft state survives. Browser-only runs
    // have no gateway or native target, which leaves every control disabled, so
    // the options are read rather than interacted with.
    await page.evaluate(async () => {
      const { useUiStore } = await import('/src/state/uiStore.ts');
      useUiStore.getState().closeRunDialog();
    });
    await page.waitForSelector('.dialog-card[aria-label="Run"]', {
      state: 'detached',
      timeout: 5_000,
    });
    await page.evaluate(async () => {
      const { useRunStore } = await import('/src/state/runStore.ts');
      const { useUiStore } = await import('/src/state/uiStore.ts');
      useRunStore.getState().setRunOptions({ replicationMode: 'precision' });
      useUiStore.getState().openRunDialog();
    });
    await page.waitForSelector('.dialog-card[aria-label="Run"]', { timeout: 5_000 });
    await page.waitForTimeout(300);
    const provenance = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.dialog-card label.field')];
      const fieldNamed = (name) =>
        labels.find((label) => label.querySelector('span')?.textContent === name);
      const metric = fieldNamed('precision metric');
      const arrivals = fieldNamed('arrivals');
      return {
        metricOptions: [...(metric?.querySelectorAll('option') ?? [])].map(
          (option) => option.value,
        ),
        arrivalsHint: arrivals?.getAttribute('title') ?? '',
      };
    });
    console.log('[snapshot] pack-declared vocabulary', JSON.stringify(provenance));
    await shot('09-run-dialog-pack-vocabulary');

    await page.evaluate(async () => {
      const { useUiStore } = await import('/src/state/uiStore.ts');
      useUiStore.getState().closeRunDialog();
    });
    await page.waitForTimeout(200);
  } else {
    console.log('[snapshot] no text editor on screen; skipped the run dialog check');
  }

  if (errors.length === 0) {
    console.log('[snapshot] no console errors');
  } else {
    console.log(`[snapshot] console errors (${errors.length}):`);
    for (const message of errors.slice(0, 10)) {
      console.log(`  - ${message}`);
    }
  }
} finally {
  await browser.close();
  if (stopRuntime !== null) await stopRuntime().catch(() => undefined);
  if (runtimeRoot !== null) {
    try {
      rmSync(runtimeRoot, { recursive: true, force: true });
    } catch (error) {
      console.log(`[snapshot] could not remove ${runtimeRoot}: ${String(error)}`);
    }
  }
}
