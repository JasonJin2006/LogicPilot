// Agent Skill manifests. Skills contribute workflow guidance; they never
// execute tools directly. Project/user skills use the portable SKILL.md shape
// supported by modern coding agents and are loaded progressively by id.

import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export const AGENT_SKILLS = Object.freeze({
  'logicpilot-modeling-basics': Object.freeze({
    id: 'logicpilot-modeling-basics',
    description: 'Build, inspect and repair a LogicPilot model using mounted tools.',
    instructions: [
      'Use the mounted modeling tools only when the task requires model state or an edit.',
      'For a new model, prefer one complete atomic patch with blocks and connections.',
      'After a failed compile, use the returned diagnostics to make a targeted repair.',
    ].join('\n'),
    capabilityIds: Object.freeze(['logicpilot-process', 'logicpilot-sysml']),
    userInvocable: true,
    modelInvocable: true,
  }),
});

export function normalizeAgentSkills(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== ''))];
}

export function resolveAgentSkills(value) {
  return normalizeAgentSkills(value)
    .map((id) => AGENT_SKILLS[id])
    .filter(Boolean);
}

export function renderAgentSkillInstructions(value) {
  return resolveAgentSkills(value)
    .map((skill) => `## Skill: ${skill.id}\n${skill.instructions}`)
    .join('\n\n');
}

const MAX_SKILL_BYTES = 128 * 1024;
const MAX_DISCOVERED_SKILLS = 64;
const SKILL_ROOT_NAMES = Object.freeze(['.agents/skills', '.github/skills', '.claude/skills']);

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return /^(true|yes|1)$/i.test(String(value).trim());
}

function parseSkillDocument(text, directoryName) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/i.exec(text);
  const frontmatter = {};
  const body = match ? match[2] : text;
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    frontmatter[key] = value;
  }
  const id = String(frontmatter.name || directoryName).trim();
  const description = String(frontmatter.description || `Skill ${id}`).trim();
  if (!id || !body.trim()) return null;
  return {
    id,
    description,
    instructions: body.trim(),
    userInvocable: parseBoolean(frontmatter['user-invocable'], true),
    modelInvocable: !parseBoolean(frontmatter['disable-model-invocation'], false),
  };
}

async function skillRoots(workspaceRoot) {
  const roots = [];
  if (typeof workspaceRoot === 'string' && isAbsolute(workspaceRoot)) {
    for (const name of SKILL_ROOT_NAMES) roots.push(join(workspaceRoot, name));
  }
  const userRoot = process.env.USERPROFILE || process.env.HOME;
  if (typeof userRoot === 'string' && isAbsolute(userRoot)) {
    for (const name of SKILL_ROOT_NAMES) roots.push(join(userRoot, name));
  }
  return roots;
}

export async function discoverAgentSkills({ workspaceRoot } = {}) {
  const discovered = [];
  for (const root of await skillRoots(workspaceRoot)) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || discovered.length >= MAX_DISCOVERED_SKILLS) continue;
      const file = resolve(root, entry.name, 'SKILL.md');
      try {
        const info = await stat(file);
        if (!info.isFile() || info.size > MAX_SKILL_BYTES) continue;
        const skill = parseSkillDocument(await readFile(file, 'utf8'), entry.name);
        if (skill && !discovered.some((item) => item.id === skill.id)) discovered.push(skill);
      } catch {
        // A broken optional skill must not make the Agent unavailable.
      }
    }
  }
  return discovered;
}

/** Resolve built-in plus project/user skills selected for this request. */
export async function loadAgentSkills(value, { workspaceRoot } = {}) {
  const selected = normalizeAgentSkills(value);
  const builtins = resolveAgentSkills(selected);
  const discovered = await discoverAgentSkills({ workspaceRoot });
  const byId = new Map(discovered.map((skill) => [skill.id, skill]));
  const ids = selected.includes('__workspace__')
    ? [...selected.filter((id) => id !== '__workspace__'), ...discovered.map((skill) => skill.id)]
    : selected;
  return ids.map((id) => builtins.find((skill) => skill.id === id) ?? byId.get(id)).filter(Boolean);
}

export async function loadAgentSkillInstructions(value, options = {}) {
  return (await loadAgentSkills(value, options))
    .map((skill) => `## Skill: ${skill.id}\n${skill.instructions}`)
    .join('\n\n');
}
