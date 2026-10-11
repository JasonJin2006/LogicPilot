#!/usr/bin/env node
// Paradigm vocabulary gate (the missing guard for the platform's own rule).
//
// docs/specs/dsl-freeze.md and the ADRs say the shell and the contracts must not
// know any single paradigm: a pack contributes its language, notation, views and
// run parameters, and the shell only offers slots. Two gates already exist
// (`zero-paradigm-verify` checks the registries are empty with no plugins,
// `paradigm-lifecycle-verify` checks contributions follow plugin lifecycle), but
// neither reads the *source text*, so a hardcoded list of paradigm names in the
// shell or in a contract schema passes both of them.
//
// This gate reads the text and fails on paradigm vocabulary. It is narrow on
// purpose, because a gate that cries wolf gets switched off:
//
//   - A hit is a string literal whose value is exactly a paradigm name
//     (`'process'`), never a longer identifier that merely contains one
//     (`logicpilot.paradigm.statechart`, `node:process`).
//   - Comments are stripped first, so prose about a paradigm is not a violation.
//   - Contracts are scanned for `enum` members only. A contract's leak vector is
//     a closed set of names; elsewhere `"source"` means provenance, not the des
//     block, and flagging it would be noise.
//
// Two lists keep the output honest, and they mean different things:
//   ALLOWED        known violations, each with the reason it is still there.
//   NOT_VOCABULARY the literal means something else here (a homonym).
//
// Usage:
//   node scripts/check-paradigm-vocabulary.mjs           exit 1 on unlisted hits
//   node scripts/check-paradigm-vocabulary.mjs --report  print every hit, exit 0

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = process.argv.includes('--report');

// --- What counts as paradigm vocabulary -----------------------------------
//
// Unambiguous paradigm and notation names. Ordinary English words that happen to
// be des block names in one context (`resource`, `delay`, `throughput`) are
// absent: they are noise here. Add one if a concrete leak shows up.
const TERMS = [
  // method / paradigm families (ADR-0132)
  'process',
  'devs',
  'continuous',
  'agent',
  'statechart',
  // notation names that name a paradigm's canvas engine
  'flow',
  'sequence',
  'stock-flow',
  'causal-loop',
  // des block vocabulary, owned by the `logicpilot.des` pack
  'source',
  'queue',
  'service',
  'sink',
  // queueing metric names, owned by the des experiment grammar
  'Wq',
  'Lq',
];

const SCAN = [
  { dir: join(root, 'web', 'apps', 'ide', 'src'), kind: 'source' },
  { dir: join(root, 'schemas', 'contracts'), kind: 'schema' },
];

/** A paradigm pack is *supposed* to name its paradigm, and tests legitimately
 *  use paradigm names as fixtures. */
function skipped(rel) {
  const parts = rel.split('/');
  if (parts.includes('plugins') && parts.includes('builtin')) return true;
  if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Blank out comments while keeping every line number intact. */
function stripComments(source) {
  let out = '';
  let inBlock = false;
  for (const line of source.split('\n')) {
    let kept = '';
    let index = 0;
    while (index < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', index);
        if (end === -1) index = line.length;
        else {
          inBlock = false;
          index = end + 2;
        }
        continue;
      }
      const lineComment = line.indexOf('//', index);
      const blockStart = line.indexOf('/*', index);
      const next =
        lineComment === -1
          ? blockStart
          : blockStart === -1
            ? lineComment
            : Math.min(lineComment, blockStart);
      if (next === -1) {
        kept += line.slice(index);
        break;
      }
      kept += line.slice(index, next);
      if (next === lineComment) break;
      inBlock = true;
      index = next + 2;
    }
    out += `${kept}\n`;
  }
  return out;
}

/** Literals in a source file, with the raw line for context. */
function sourceHits(clean) {
  const found = [];
  const pattern = /'([^'\\\n]*)'|"([^"\\\n]*)"/g;
  let match;
  while ((match = pattern.exec(clean)) !== null) {
    const term = match[1] ?? match[2] ?? '';
    if (!TERMS.includes(term)) continue;
    const line = clean.slice(0, match.index).split('\n').length;
    found.push({ term, line, text: (clean.split('\n')[line - 1] ?? '').trim() });
  }
  return found;
}

/** `enum` members only: the way a contract can close a set of paradigm names. */
function schemaHits(rel, full) {
  const raw = readFileSync(full, 'utf8');
  const lines = raw.split('\n');
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry !== 'string' || !TERMS.includes(entry)) continue;
          const needle = `"${entry}"`;
          const index = lines.findIndex((text) => text.includes(needle));
          found.push({
            term: entry,
            line: index === -1 ? 1 : index + 1,
            text: (lines[index] ?? '').trim(),
          });
        }
      }
      walk(value);
    }
  };
  walk(JSON.parse(raw));
  return found;
}

// --- The two lists --------------------------------------------------------
//
// Both are (file, term) keyed, so a listed file that gains a *different*
// paradigm word still fails. That is the point: a ledger records debt, it does
// not exempt whole files. Removing an entry never fails the gate.

/** Known violations, with the reason each is still there. */
const ALLOWED = new Map();
/** The literal means something else here; not paradigm vocabulary. */
const NOT_VOCABULARY = new Map();

function claim(list, file, terms, reason) {
  list.set(
    file,
    new Map(terms.map((term) => [term, reason])),
  );
}

// Contracts: the canvas engine id mixes mechanism names with notation names.
claim(
  ALLOWED,
  'schemas/contracts/view-notation.schema.json',
  ['flow', 'statechart', 'sequence', 'stock-flow', 'causal-loop'],
  'CanvasEngineId mixes mechanism ids with notation names; a paradigm shipping its own canvas still has to change the contract (ide-layout §7).',
);
claim(
  ALLOWED,
  'schemas/contracts/baseline/view-notation.schema.json',
  ['flow', 'statechart', 'sequence', 'stock-flow', 'causal-loop'],
  'Frozen copy of view-notation.schema.json; the two move together.',
);

// Block, palette and canvas layer: the built-in AnyLogic-derived library is
// shell-resident, but it is read through the palette contribution registry and
// the ModelSemanticProvider seam, so a pack can replace it. Tracked in
// ide-layout §7.
const BLOCK_LAYER =
  'Built-in block catalog is shell-resident; palette and canvas read it through PALETTE_CONTRIBUTIONS and ModelSemanticProvider, so a pack can replace it (ide-layout §7).';
claim(
  ALLOWED,
  'web/apps/ide/src/model/blockDefs.ts',
  ['process', 'statechart', 'agent', 'continuous', 'source', 'queue', 'service', 'sink'],
  BLOCK_LAYER,
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/blockCatalog.ts',
  ['source', 'queue', 'service', 'sink', 'agent'],
  'Generated from libraries/pml-catalog.json (AnyLogic-derived process library); regenerate, do not hand-edit.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/BlockIcon.tsx',
  ['process', 'statechart', 'source', 'queue', 'service', 'sink'],
  BLOCK_LAYER,
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/ModelCanvas.tsx',
  ['process', 'statechart', 'agent', 'continuous', 'queue', 'service'],
  BLOCK_LAYER,
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/modelValidation.ts',
  ['process', 'source', 'queue', 'service'],
  'Des semantics validated in the shell; the pack already contributes diagnostics for this.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/canvasInsert.ts',
  ['process', 'statechart'],
  BLOCK_LAYER,
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/paletteContributions.ts',
  ['process'],
  'Special-cases the process library as the one that emits DSL; belongs to the pack contribution.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/model/PropertiesPanel.tsx',
  ['source'],
  BLOCK_LAYER,
);

// Intent to canvas tables, hardcoded per paradigm.
claim(
  ALLOWED,
  'web/apps/ide/src/plugins/viewPlanner.ts',
  ['process', 'flow', 'statechart', 'sequence', 'stock-flow', 'causal-loop'],
  'Keyword and canvas tables per paradigm; should be contributed by the pack that owns the canvas.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/ai/capabilities/view-planning/tools.ts',
  ['flow', 'statechart', 'sequence', 'stock-flow', 'causal-loop'],
  'Same canvas list as viewPlanner.ts.',
);

claim(
  ALLOWED,
  'web/apps/ide/src/ai/capabilities/logicpilot-modeling/mutationTools.ts',
  ['process'],
  'Applies the process-library rule; should come from the pack.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/ai/capabilities/logicpilot-modeling/sysmlTools.ts',
  ['flow'],
  'Names the canvas it projects into.',
);

// Queueing metric names: the vocabulary we moved to runParameters, still
// hardcoded for labels and defaults.
claim(
  ALLOWED,
  'web/apps/ide/src/ai/assistantRuntime.ts',
  ['Wq', 'Lq'],
  'Metric glossary for explanations; the des pack should contribute metric labels via knowledge.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/ai/contextBuilder.ts',
  ['Wq', 'Lq'],
  'Builds a metric summary by name; same fix as assistantRuntime.ts.',
);

// Project layer: hardcoded container kinds and templates.
claim(
  ALLOWED,
  'web/apps/ide/src/project/project.ts',
  ['agent', 'continuous', 'statechart', 'source'],
  'Container kinds and default block kind hardcoded in the project layer.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/project/projectTree.ts',
  ['agent', 'continuous'],
  'Container templates are hardcoded text; belongs to the pack grammar.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/project/syncEngine.ts',
  ['process', 'statechart'],
  'Container handling hardcoded in the sync engine.',
);
claim(
  ALLOWED,
  'web/apps/ide/src/project/dslOutlineContribution.tsx',
  ['agent', 'continuous'],
  'Outline groups containers by kind; the vocabulary is the pack language.',
);

// SysML: an entire paradigm-shaped module living inside the shell tree.
const SYSML_MODULE =
  'The SysML module lives in the shell tree rather than as a pack; ADR-0138 keeps it a pack, so this moves with that work.';
claim(ALLOWED, 'web/apps/ide/src/sysml/sysmlParser.ts', ['flow'], SYSML_MODULE);
claim(ALLOWED, 'web/apps/ide/src/sysml/sysmlLanguage.ts', ['flow'], SYSML_MODULE);
claim(ALLOWED, 'web/apps/ide/src/sysml/sysmlIcons.tsx', ['flow'], SYSML_MODULE);
claim(ALLOWED, 'web/apps/ide/src/sysml/sysmlEdits.ts', ['flow'], SYSML_MODULE);
claim(ALLOWED, 'web/apps/ide/src/sysml/sysmlProjection.ts', ['flow'], SYSML_MODULE);
claim(ALLOWED, 'web/apps/ide/src/sysml/SysMLCanvas.tsx', ['flow', 'sequence'], SYSML_MODULE);
claim(
  ALLOWED,
  'web/apps/ide/src/sysml/sysmlPaletteContribution.tsx',
  ['flow'],
  SYSML_MODULE,
);
claim(ALLOWED, 'web/apps/ide/src/state/sysmlStore.ts', ['sequence'], SYSML_MODULE);

// Homonyms: the same word, a different meaning. Not debt.
claim(
  NOT_VOCABULARY,
  'web/apps/ide/src/artifacts/artifactGraphClient.ts',
  ['agent'],
  'An artifact actor (`createdBy: agent` means the AI), not the agent paradigm.',
);

// --- Run ------------------------------------------------------------------

const hits = [];
for (const { dir, kind } of SCAN) {
  for (const file of walk(dir)) {
    const rel = relative(root, file).split(sep).join('/');
    if (skipped(rel)) continue;
    const found = kind === 'schema' ? schemaHits(rel, file) : sourceHits(stripComments(readFileSync(file, 'utf8')));
    for (const hit of found) {
      hits.push({
        file: rel,
        ...hit,
        debt: ALLOWED.get(rel)?.get(hit.term),
        homonym: NOT_VOCABULARY.get(rel)?.get(hit.term),
      });
    }
  }
}

const unlisted = hits.filter((hit) => hit.debt === undefined && hit.homonym === undefined);

if (report) {
  const known = hits.length - unlisted.length;
  console.log(`[vocabulary] ${hits.length} hit(s): ${known} listed, ${unlisted.length} unlisted\n`);
  for (const hit of hits) {
    const mark = hit.homonym !== undefined ? 'homonym' : hit.debt === undefined ? 'NEW' : 'debt';
    console.log(`[${mark}] ${hit.file}:${hit.line}  '${hit.term}'`);
    console.log(`        ${hit.text.slice(0, 160)}`);
    const reason = hit.homonym ?? hit.debt;
    if (reason !== undefined) console.log(`        reason: ${reason}`);
  }
  process.exit(0);
}

if (unlisted.length > 0) {
  console.error(`[vocabulary] FAIL: ${unlisted.length} paradigm literal(s) outside both lists.`);
  for (const hit of unlisted) {
    console.error(`  ${hit.file}:${hit.line}  '${hit.term}'`);
    console.error(`    ${hit.text.slice(0, 160)}`);
  }
  console.error(
    '\nA paradigm name in the shell or in a contract means the platform knows a single\n' +
      'paradigm. Move it into the pack that owns the word (a contribution key, a `use`\n' +
      'declaration, or a declared id), or add it to ALLOWED in this script with the\n' +
      'reason it is still there. See docs/specs/ide-layout.md §7.',
  );
  process.exit(1);
}

console.log(
  `[vocabulary] OK: ${hits.length} known hit(s), all listed ` +
    `(${ALLOWED.size} debt file(s), ${NOT_VOCABULARY.size} homonym file(s))`,
);
