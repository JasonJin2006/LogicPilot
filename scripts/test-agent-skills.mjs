import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverAgentSkills,
  loadAgentSkillInstructions,
} from './agent-skills.mjs';

const root = await mkdtemp(join(tmpdir(), 'logicpilot-agent-skills-'));
try {
  const skillDir = join(root, '.agents', 'skills', 'queue-review');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: queue-review',
      'description: Review queue settings',
      'user-invocable: true',
      '---',
      'Review queue capacity and explain the measured impact.',
      '',
    ].join('\n'),
  );
  const discovered = await discoverAgentSkills({ workspaceRoot: root });
  assert.deepEqual(discovered.map((skill) => skill.id), ['queue-review']);
  assert.match(
    await loadAgentSkillInstructions(['queue-review'], { workspaceRoot: root }),
    /Review queue capacity/,
  );
  assert.match(
    await loadAgentSkillInstructions(['logicpilot-modeling-basics'], { workspaceRoot: root }),
    /mounted modeling tools/,
  );
  console.log('AGENT-SKILLS TEST: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
