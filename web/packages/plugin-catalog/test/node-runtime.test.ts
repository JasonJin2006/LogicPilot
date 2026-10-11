import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginManifest } from '@logicpilot/contracts';
import {
  computePackageDigest,
  NodePluginRuntime,
  SERVICE_CALL_DEADLINE_MARGIN_MS,
  serviceCallDeadlineMs,
} from '../src/index.js';

const cleanups: string[] = [];

function lifecycleManifest(id: string) {
  return {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: { node: './activate.mjs' },
    permissions: [],
    trust: { minLevel: 't0' },
    executionTargets: [
      {
        schema: 'logicpilot.execution-target/v1',
        contractVersion: 1,
        id: `${id}.target`,
        artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
        runtime: { kind: 'interpreter', pluginId: id },
      },
    ],
  } as PluginManifest;
}

function lifecycleRequest(requestId: string) {
  return {
    schema: 'logicpilot.execution-request/v1',
    contractVersion: 1,
    requestId,
    targetId: 'logicpilot.lifecycle-plugin.target',
  };
}

function defaultContributions(pluginId: string, version: string) {
  return {
    schema: 'logicpilot.plugin-contributions/v1',
    contractVersion: 1,
    pluginId,
    version,
    knowledge: [],
    skills: [],
    instructions: [],
    diagnostics: [],
    views: [],
    notations: [],
    createActions: [],
    palettes: [],
    tools: [],
  };
}

function serviceManifest(id: string) {
  return {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: { node: './activate.mjs' },
    permissions: [],
    trust: { minLevel: 't0' },
    services: [
      { name: 'svc', methods: [{ name: 'call' }, { name: 'status' }] },
      { name: 'singleton', methods: [{ name: 'call' }] },
    ],
  } as PluginManifest;
}

function writePluginSimple(dir: string, manifest: PluginManifest) {
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
  writeFileSync(
    join(dir, 'contributions.json'),
    JSON.stringify(defaultContributions(manifest.id, manifest.version)),
  );
}

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

describe('NodePluginRuntime', () => {
  it('scans, dynamically loads and activates a package through PluginHost', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const pkg = join(root, 'runtime-plugin');
    mkdirSync(pkg);
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.runtime-plugin',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { node: './activate.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
      executionTargets: [
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'logicpilot.runtime-plugin.target',
          artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
          runtime: { kind: 'interpreter', pluginId: 'logicpilot.runtime-plugin' },
        },
      ],
    } as PluginManifest;
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'export function activate(ctx) { ctx.provide("ok", true); }\n' +
        'export function execute(request) { return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-1", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: "completed" } }; }',
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    writeFileSync(
      join(pkg, 'contributions.json'),
      JSON.stringify({
        schema: 'logicpilot.plugin-contributions/v1',
        contractVersion: 1,
        pluginId: manifest.id,
        version: manifest.version,
        knowledge: [],
        skills: [],
        instructions: [],
        diagnostics: [],
        views: [],
        notations: [],
        createActions: [],
        palettes: [],
        tools: [],
      }),
    );
    // The scanner computes this digest and the dynamic loader verifies the
    // same manifest-bound value end to end.
    const digest = computePackageDigest(pkg, manifest);
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
    });
    const host = await runtime.start();
    expect(host.phaseValue).toBe('active');
    expect(host.isActive('logicpilot.runtime-plugin')).toBe(true);
    expect(runtime.snapshot()?.generation).toBe(1);
    expect(runtime.contributionRegistry().snapshot().sets[0]?.pluginId).toBe(manifest.id);
    expect(host.manifestOf('logicpilot.runtime-plugin')?.id).toBe(manifest.id);
    expect(
      runtime
        .executionTargetRegistry()
        .list()
        .map((target) => target.id),
    ).toEqual(['logicpilot.runtime-plugin.target']);
    const execution = await runtime
      .executionTargetRegistry()
      .execute('logicpilot.runtime-plugin.target', {
        schema: 'logicpilot.execution-request/v1',
        contractVersion: 1,
        requestId: 'request-1',
        targetId: 'logicpilot.runtime-plugin.target',
      });
    expect(execution.run.status).toBe('completed');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    let changes = 0;
    const unsubscribe = runtime.subscribe(() => {
      changes += 1;
    });
    const stopWatch = runtime.watch(100);
    writeFileSync(
      join(pkg, 'activate.mjs'),
      readFileSync(join(pkg, 'activate.mjs'), 'utf8').replace('"ok", true', '"ok", false'),
    );
    await expect.poll(() => runtime.snapshot()?.generation, { timeout: 3_000 }).toBe(2);
    stopWatch();
    unsubscribe();
    expect(changes).toBeGreaterThanOrEqual(1);
    expect(runtime.snapshot()?.generation).toBe(2);
    // A replacement that impersonates another target owner must not replace
    // the working generation or leak a second execution target.
    const invalid = {
      ...manifest,
      executionTargets: manifest.executionTargets!.map((target) => ({
        ...target,
        runtime: { ...target.runtime, pluginId: 'logicpilot.foreign' },
      })),
    };
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(invalid));
    await expect(runtime.refresh()).rejects.toThrow(/owner mismatch/);
    expect(runtime.snapshot()?.generation).toBe(2);
    expect(runtime.executionTargetRegistry().list()).toHaveLength(1);
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    await runtime.stop();
    expect(host.phaseValue).toBe('stopped');
    expect(runtime.executionTargetRegistry().list()).toEqual([]);

    const lockedOut = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      requireLockfile: true,
      lockfile: {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: [
          {
            id: manifest.id,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            sha256: 'a'.repeat(64),
            trust: 't4',
            permissions: [],
          },
        ],
      },
    });
    const deniedHost = await lockedOut.start();
    expect(deniedHost.isActive(manifest.id)).toBe(false);
    await lockedOut.stop();

    const currentDigest = computePackageDigest(join(root, 'runtime-plugin'), manifest);
    const approvedRuntime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      requireLockfile: true,
      lockfile: {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: [
          {
            id: manifest.id,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            sha256: currentDigest,
            source: 'local-upload',
            trust: 't4',
            permissions: [],
          },
        ],
      },
    });
    const approvedHost = await approvedRuntime.start();
    expect(approvedHost.isActive(manifest.id)).toBe(true);
    await approvedRuntime.stop();
  });

  it('denies a kernel service call before any service side effect when the caller does not own the runtime', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const pkg = join(root, 'service-rogue');
    mkdirSync(pkg);
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.service-rogue',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { node: './activate.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
      executionTargets: [
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'logicpilot.service-rogue.target',
          artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
          runtime: { kind: 'interpreter', pluginId: 'logicpilot.service-rogue' },
          // The plugin owns a DEVS target, so requesting the process kernel is
          // an ownership mismatch the host must reject.
          options: { paradigm: 'devs' },
        },
      ],
    } as PluginManifest;
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'let kernel;\n' +
        'export function activate(ctx) { kernel = ctx.service("logicpilot.execution.kernel"); ctx.provide("ok", true); }\n' +
        'export function execute(request) { return kernel.call({ runtimeKind: "process", dsl: "model X {}" }); }',
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    writeFileSync(
      join(pkg, 'contributions.json'),
      JSON.stringify({
        schema: 'logicpilot.plugin-contributions/v1',
        contractVersion: 1,
        pluginId: manifest.id,
        version: manifest.version,
        knowledge: [],
        skills: [],
        instructions: [],
        diagnostics: [],
        views: [],
        notations: [],
        createActions: [],
        palettes: [],
        tools: [],
      }),
    );
    let kernelCalls = 0;
    const audits: Array<{ action: string; capability: string; detail?: string }> = [];
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([[manifest.id, [{ permissionId: 'runtime.service.call', granted: true }]]]),
      services: new Map([
        [
          'logicpilot.execution.kernel',
          () => {
            kernelCalls += 1;
            throw new Error('side effect must never run for a denied call');
          },
        ],
      ]),
      onAudit: (event) => audits.push(event),
    });
    await runtime.start();
    await expect(
      runtime.executionTargetRegistry().execute('logicpilot.service-rogue.target', {
        schema: 'logicpilot.execution-request/v1',
        contractVersion: 1,
        requestId: 'rogue-1',
        targetId: 'logicpilot.service-rogue.target',
      }),
    ).rejects.toThrow(/runtime-not-owned/);
    expect(kernelCalls).toBe(0);
    expect(
      audits.some(
        (event) =>
          event.action === 'deny' && event.detail === 'runtime.service.call:runtime-not-owned',
      ),
    ).toBe(true);
    await runtime.stop();
  });

  it('service call deadlines follow the requested wall budget instead of the activation timeout', () => {
    // A kernel run with a 10-minute budget must not be cut off by the 10s
    // activation fallback used for ordinary capability requests.
    expect(serviceCallDeadlineMs(1_000, 600_000, 10_000)).toBe(
      1_000 + 600_000 + SERVICE_CALL_DEADLINE_MARGIN_MS,
    );
    expect(serviceCallDeadlineMs(1_000, 1_500, 10_000)).toBe(
      1_000 + 1_500 + SERVICE_CALL_DEADLINE_MARGIN_MS,
    );
    // Invalid or absent budgets keep the activation fallback.
    expect(serviceCallDeadlineMs(1_000, undefined, 10_000)).toBe(11_000);
    expect(serviceCallDeadlineMs(1_000, 0, 10_000)).toBe(11_000);
    expect(serviceCallDeadlineMs(1_000, 'forty', 10_000)).toBe(11_000);
  });

  it('keeps the retained generation fully usable when a refresh fails', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const pkg = join(root, 'lifecycle-plugin');
    mkdirSync(pkg);
    const manifest = lifecycleManifest('logicpilot.lifecycle-plugin');
    // execute() dispatches a real host service so the session path (not just a
    // canned run object) is exercised.
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'let ping;\n' +
        'export function activate(ctx) { ping = ctx.service("logicpilot.test-ping"); ctx.provide("ok", true); }\n' +
        'export async function execute(request) { await ping.call({}); return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-ping", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: "completed" } }; }',
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    writeFileSync(
      join(pkg, 'contributions.json'),
      JSON.stringify(defaultContributions(manifest.id, manifest.version)),
    );
    let pingCalls = 0;
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([[manifest.id, [{ permissionId: 'runtime.service.call', granted: true }]]]),
      services: new Map([
        [
          'logicpilot.test-ping',
          () => {
            pingCalls += 1;
            return { pong: true };
          },
        ],
      ]),
    });
    const host = await runtime.start();
    expect(runtime.snapshot()?.generation).toBe(1);
    const first = await runtime
      .executionTargetRegistry()
      .execute('logicpilot.lifecycle-plugin.target', lifecycleRequest('request-1'));
    expect(first.run.status).toBe('completed');
    expect(pingCalls).toBe(1);
    // Make the next refresh fail by impersonating another target owner.
    const invalid = {
      ...manifest,
      executionTargets: manifest.executionTargets!.map((target) => ({
        ...target,
        runtime: { ...target.runtime, pluginId: 'logicpilot.foreign' },
      })),
    };
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(invalid));
    await expect(runtime.refresh()).rejects.toThrow(/owner mismatch/);
    // The retained generation must still be fully usable: same generation,
    // still active, target installed, and a capability dispatch still works
    // (it would have come back "runtime session unavailable" before the fix).
    expect(runtime.snapshot()?.generation).toBe(1);
    expect(host.isActive(manifest.id)).toBe(true);
    expect(runtime.executionTargetRegistry().list()).toHaveLength(1);
    const again = await runtime
      .executionTargetRegistry()
      .execute('logicpilot.lifecycle-plugin.target', lifecycleRequest('request-2'));
    expect(again.run.status).toBe('completed');
    expect(pingCalls).toBe(2);
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    await runtime.stop();
  });

  it('tears down the old generation on refresh, revives on start, and reflects uninstall', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const pkg = join(root, 'lifecycle-plugin');
    mkdirSync(pkg);
    const manifest = lifecycleManifest('logicpilot.lifecycle-plugin');
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'export function activate(ctx) { ctx.provide("ok", true); }\n' +
        'export function execute(request) { return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-life", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: "completed" } }; }',
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    writeFileSync(
      join(pkg, 'contributions.json'),
      JSON.stringify(defaultContributions(manifest.id, manifest.version)),
    );
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
    });
    const host = await runtime.start();
    expect(host.isActive(manifest.id)).toBe(true);
    // A successful refresh swaps the generation: the previous host is stopped
    // and its session and target are revoked.
    await runtime.refresh();
    expect(host.phaseValue).toBe('stopped');
    expect(runtime.snapshot()?.generation).toBe(2);
    expect(runtime.executionTargetRegistry().list()).toHaveLength(1);
    const next = runtime.snapshot()?.host;
    expect(next?.isActive(manifest.id)).toBe(true);
    // stop() is not uninstall: the plugin re-activates on start().
    await runtime.stop();
    expect(runtime.executionTargetRegistry().list()).toEqual([]);
    await runtime.start();
    expect(runtime.snapshot()?.host?.isActive(manifest.id)).toBe(true);
    expect(runtime.executionTargetRegistry().list()).toHaveLength(1);
    // Removing the package from the catalog is reflected by a refresh.
    rmSync(pkg, { recursive: true, force: true });
    await runtime.refresh();
    expect(runtime.snapshot()?.host?.isActive(manifest.id)).toBe(false);
    expect(runtime.executionTargetRegistry().list()).toEqual([]);
    await runtime.stop();
  });

  it('routes a worker-provided service call, enforces its method whitelist and rejects a duplicate provider', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    // Activation order follows the catalog scan (alphabetical by directory), so
    // the provider lands before the duplicate that must be denied.
    const providerDir = join(root, 'a-provider');
    mkdirSync(providerDir);
    const provider = serviceManifest('logicpilot.a-provider');
    writeFileSync(
      join(providerDir, 'activate.mjs'),
      'export async function activate(ctx) { await ctx.provide("svc", { call: async (n) => n * 2, status: async () => "alive" }); }',
    );
    writePluginSimple(providerDir, provider);
    // Caller invokes the service from a target run.
    const callerDir = join(root, 'b-caller');
    mkdirSync(callerDir);
    const caller = {
      ...serviceManifest('logicpilot.b-caller'),
      executionTargets: [
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'logicpilot.b-caller.target',
          artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
          runtime: { kind: 'interpreter', pluginId: 'logicpilot.b-caller' },
        },
      ],
    } as PluginManifest;
    writeFileSync(
      join(callerDir, 'activate.mjs'),
      'let svc;\n' +
        'export function activate(ctx) { svc = ctx.service("svc"); ctx.provide("ok", true); }\n' +
        'export async function execute(request) {\n' +
        '  const method = request.inputs?.method ?? "call";\n' +
        '  const result = await svc[method](21);\n' +
        '  return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-svc", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: result === 42 ? "completed" : "failed", ...(result === 42 ? {} : { error: "bad result " + result }) } };\n' +
        '}',
    );
    writePluginSimple(callerDir, caller);
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([
        [provider.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
        [caller.id, [{ permissionId: 'runtime.service.call', granted: true }]],
      ]),
    });
    await runtime.start();
    // The provider registered its service; the caller's run reaches it.
    const run = await runtime.executionTargetRegistry().execute('logicpilot.b-caller.target', {
      ...lifecycleRequest('svc-request'),
      targetId: 'logicpilot.b-caller.target',
    });
    expect(run.run.status).toBe('completed');
    await runtime.refresh();
    const afterRefresh = await runtime
      .executionTargetRegistry()
      .execute('logicpilot.b-caller.target', {
        ...lifecycleRequest('svc-refresh'),
        targetId: 'logicpilot.b-caller.target',
      });
    expect(afterRefresh.run.status).toBe('completed');
    // A method outside the whitelist is denied before any side effect.
    await runtime.stop();
    const probeRuntime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([
        [provider.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
        [caller.id, [{ permissionId: 'runtime.service.call', granted: true }]],
      ]),
    });
    await probeRuntime.start();
    await expect(
      probeRuntime.executionTargetRegistry().execute('logicpilot.b-caller.target', {
        ...lifecycleRequest('svc-bogus'),
        targetId: 'logicpilot.b-caller.target',
        inputs: { method: 'bogus' },
      }),
    ).rejects.toThrow(/method-not-allowed/);
    await probeRuntime.stop();
    // A duplicate provider of the same name is rejected (service-exists); the
    // plugin still activates (a colliding provide is not a fatal activation
    // failure) and exposes the denial through its own run.
    const duplicateDir = join(root, 'z-duplicate');
    mkdirSync(duplicateDir);
    const duplicate = {
      ...serviceManifest('logicpilot.z-duplicate'),
      executionTargets: [
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'logicpilot.z-duplicate.target',
          artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
          runtime: { kind: 'interpreter', pluginId: 'logicpilot.z-duplicate' },
        },
      ],
    } as PluginManifest;
    writeFileSync(
      join(duplicateDir, 'activate.mjs'),
      'let provideResult;\n' +
        'export async function activate(ctx) { provideResult = await ctx.provide("svc", { call: async () => 1 }); }\n' +
        'export function execute(request) { return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-dup", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: provideResult && provideResult.ok ? "completed" : "failed", ...(provideResult && provideResult.ok ? {} : { error: provideResult && provideResult.error }) } }; }',
    );
    writePluginSimple(duplicateDir, duplicate);
    const runtime2 = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([
        [provider.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
        [caller.id, [{ permissionId: 'runtime.service.call', granted: true }]],
        [duplicate.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
      ]),
    });
    await runtime2.start();
    // The original service still routes to the original provider.
    const stillOk = await runtime2.executionTargetRegistry().execute('logicpilot.b-caller.target', {
      ...lifecycleRequest('svc-upstream'),
      targetId: 'logicpilot.b-caller.target',
    });
    expect(stillOk.run.status).toBe('completed');
    // The duplicate's provide was denied, observable through its own run.
    const dupRun = await runtime2
      .executionTargetRegistry()
      .execute('logicpilot.z-duplicate.target', {
        ...lifecycleRequest('svc-dup'),
        targetId: 'logicpilot.z-duplicate.target',
      });
    expect(dupRun.run.status).toBe('failed');
    expect(dupRun.run.error).toBe('service-exists');
    await runtime.stop();
    await runtime2.stop();
  });

  it('disposes worker-provided services when their generation is unloaded', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const providerDir = join(root, 'a-provider');
    mkdirSync(providerDir);
    const provider = serviceManifest('logicpilot.a-provider');
    writeFileSync(
      join(providerDir, 'activate.mjs'),
      'export async function activate(ctx) { const r = await ctx.provide("singleton", { call: async () => 1 }); if (!r.ok) throw new Error("provider denied: " + r.error); }',
    );
    writePluginSimple(providerDir, provider);
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([
        [provider.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
      ]),
    });
    await runtime.start();
    // Use a caller plugin to invoke the provided service.
    const callerDir = join(root, 'b-caller');
    mkdirSync(callerDir);
    const caller = {
      ...serviceManifest('logicpilot.b-caller'),
      executionTargets: [
        {
          schema: 'logicpilot.execution-target/v1',
          contractVersion: 1,
          id: 'logicpilot.b-caller.target',
          artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
          runtime: { kind: 'interpreter', pluginId: 'logicpilot.b-caller' },
        },
      ],
    } as PluginManifest;
    writeFileSync(
      join(callerDir, 'activate.mjs'),
      'let singleton;\n' +
        'export function activate(ctx) { singleton = ctx.service("singleton"); ctx.provide("ok", true); }\n' +
        'export async function execute(request) { await singleton.call(); return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-disp", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: "completed" } }; }',
    );
    writePluginSimple(callerDir, caller);
    const runtime2 = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([
        [provider.id, [{ permissionId: 'runtime.service.provide', granted: true }]],
        [caller.id, [{ permissionId: 'runtime.service.call', granted: true }]],
      ]),
    });
    await runtime2.start();
    // Now remove the provider and refresh: the service must be disposed.
    rmSync(providerDir, { recursive: true, force: true });
    await runtime2.refresh();
    const runtime3 = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      grants: new Map([[caller.id, [{ permissionId: 'runtime.service.call', granted: true }]]]),
    });
    await runtime3.start();
    await expect(
      runtime2.executionTargetRegistry().execute('logicpilot.b-caller.target', {
        ...lifecycleRequest('disp-request'),
        targetId: 'logicpilot.b-caller.target',
      }),
    ).rejects.toThrow(/unavailable|not callable/);
    await runtime.stop();
    await runtime2.stop();
    await runtime3.stop();
  });
});
