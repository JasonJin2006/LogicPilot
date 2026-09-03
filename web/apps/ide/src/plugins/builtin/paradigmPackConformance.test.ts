import { describe, expect, it } from 'vitest';
import { validateContract } from '@logicpilot/contracts';
import agentManifest from './agent/plugin.json';
import agentContributions from './agent/contributions.json';
import continuousManifest from './continuous/plugin.json';
import continuousContributions from './continuous/contributions.json';
import c4Manifest from './c4/plugin.json';
import c4Contributions from './c4/contributions.json';
import desManifest from './des/plugin.json';
import desContributions from './des/contributions.json';
import devsManifest from './devs/plugin.json';
import devsContributions from './devs/contributions.json';
import statechartManifest from './statechart/plugin.json';
import statechartContributions from './statechart/contributions.json';
import sysmlManifest from './sysml/plugin.json';
import sysmlContributions from './sysml/contributions.json';

const packs = [
  {
    manifest: agentManifest,
    contributions: agentContributions,
    paradigm: 'logicpilot-agent',
    canvas: 'sequence',
  },
  {
    manifest: continuousManifest,
    contributions: continuousContributions,
    paradigm: 'logicpilot-continuous',
    canvas: 'chart',
  },
  {
    manifest: c4Manifest,
    contributions: c4Contributions,
    paradigm: 'logicpilot-c4',
    canvas: 'graph2d',
  },
  {
    manifest: desManifest,
    contributions: desContributions,
    paradigm: 'logicpilot-process',
    canvas: 'flow',
  },
  {
    manifest: devsManifest,
    contributions: devsContributions,
    paradigm: 'logicpilot-devs',
    canvas: 'flow',
  },
  {
    manifest: statechartManifest,
    contributions: statechartContributions,
    paradigm: 'logicpilot-statechart',
    canvas: 'statechart',
  },
  {
    manifest: sysmlManifest,
    contributions: sysmlContributions,
    paradigm: 'logicpilot-sysml',
    canvas: 'graph2d',
  },
] as const;

describe('builtin paradigm pack conformance', () => {
  for (const pack of packs) {
    it(`${pack.manifest.id} has a complete structured pack`, () => {
      const manifest = validateContract('PluginManifest', pack.manifest);
      expect(manifest.ok).toBe(true);
      const contributions = validateContract('PluginContributionSet', pack.contributions);
      expect(contributions.ok).toBe(true);
      if (!contributions.ok) return;
      expect(contributions.value.pluginId).toBe(pack.manifest.id);
      expect(contributions.value.knowledge.length).toBeGreaterThan(0);
      expect(contributions.value.skills.length).toBeGreaterThan(0);
      expect(contributions.value.instructions.length).toBeGreaterThan(0);
      expect(contributions.value.diagnostics.length).toBeGreaterThan(0);
      expect(contributions.value.views.some((view) => view.canvas === pack.canvas)).toBe(true);
      expect(
        contributions.value.knowledge.some((block) =>
          block.scope?.paradigms?.includes(pack.paradigm),
        ),
      ).toBe(true);
      expect(
        contributions.value.instructions.some((instruction) => instruction.scope === pack.paradigm),
      ).toBe(true);
      for (const definition of contributions.value.diagnostics) {
        expect(definition.appliesToParadigms).toContain(pack.paradigm);
      }
    });
  }

  it('keeps SysML and C4 on Graph2D with distinct notation owners', () => {
    const sysml = validateContract('PluginContributionSet', sysmlContributions);
    const c4 = validateContract('PluginContributionSet', c4Contributions);
    expect(sysml.ok && c4.ok).toBe(true);
    if (!sysml.ok || !c4.ok) return;
    expect(sysml.value.views.some((view) => view.canvas === 'graph2d')).toBe(true);
    expect(c4.value.views.some((view) => view.canvas === 'graph2d')).toBe(true);
    expect(sysml.value.notations[0]?.id).not.toBe(c4.value.notations[0]?.id);
    expect(sysml.value.notations[0]?.owner).not.toBe(c4.value.notations[0]?.owner);
  });
});
