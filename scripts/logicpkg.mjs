#!/usr/bin/env node
// logicpkg - LogicPilot library package tool (P2 developer ecosystem).
//
// A library package is a directory of DSL library files (.lplib), a palette
// JSON (IDE custom-library import), icons and a manifest; `pack` bundles it
// into one portable .lpkg file and `install` extracts it back.
//
// Usage:
//   node scripts/logicpkg.mjs init <dir> [--name <id>]
//   node scripts/logicpkg.mjs pack <dir> -o <out.lpkg>
//   node scripts/logicpkg.mjs install <pkg.lpkg> --dir <target>
//   node scripts/logicpkg.mjs list <pkg.lpkg>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Text (JSON/DSL/README) stays human-readable in the .lpkg; anything that is
// not valid UTF-8 (icons, fonts) is stored as base64 and restored on install.
// Without this, Pack readFileSync(path,'utf8') silently replaced every
// invalid byte with U+FFFD and repeated pack/install roundtrips corrupted
// binary assets.
function encodeFile(path) {
  const data = readFileSync(path);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data) };
  } catch {
    return { text: data.toString('base64'), binary: true };
  }
}

function decodeContent(content, binary) {
  return binary ? Buffer.from(content, 'base64') : content;
}

const SCHEMA = 'logicpilot.lpkg';
const VERSION = 1;

function collectFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...collectFiles(path, base));
    } else {
      out.push([relative(base, path).replaceAll('\\', '/'), path]);
    }
  }
  return out;
}

function manifestTemplate(name) {
  return {
    schema: SCHEMA,
    version: VERSION,
    name,
    description: '',
    files: ['library.lplib', 'palette.json'],
  };
}

function cmdInit(target, name) {
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, 'manifest.json'),
    JSON.stringify(manifestTemplate(name), null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(target, 'library.lplib'),
    `library ${name} {\n  // block declarations: block <Kind> { field: type }\n}\n`,
    'utf8',
  );
  writeFileSync(
    join(target, 'palette.json'),
    JSON.stringify({ library: name, blocks: [] }, null, 2) + '\n',
    'utf8',
  );
  console.log(`initialized library package in '${target}'`);
}

function cmdPack(dir, outPath) {
  const files = collectFiles(dir);
  const bundle = {
    schema: SCHEMA,
    version: VERSION,
    files: {},
  };
  const binary = [];
  for (const [rel, path] of files) {
    const encoded = encodeFile(path);
    bundle.files[rel] = encoded.text;
    if (encoded.binary) binary.push(rel);
  }
  if (binary.length > 0) bundle.binary = binary;
  writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  console.log(`packed ${files.length} files -> '${outPath}'`);
}

function cmdInstall(pkgPath, target) {
  const bundle = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (bundle.schema !== SCHEMA) {
    throw new Error(`not a ${SCHEMA} package: '${pkgPath}'`);
  }
  const root = resolve(target);
  const binary = new Set(bundle.binary ?? []);
  mkdirSync(root, { recursive: true });
  let count = 0;
  for (const [rel, content] of Object.entries(bundle.files ?? {})) {
    // Separator-aware containment: '..' or absolute rel must never escape
    // the install root (a bare startsWith prefix check let '../libs2/x'
    // through on Windows, where 'libs' is a prefix of 'libs2').
    const dest = resolve(root, rel);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new Error(`unsafe path in package: '${rel}'`);
    }
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, decodeContent(content, binary.has(rel)));
    ++count;
  }
  console.log(`installed ${count} files into '${target}'`);
}

function cmdList(pkgPath) {
  const bundle = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (bundle.schema !== SCHEMA) {
    throw new Error(`not a ${SCHEMA} package: '${pkgPath}'`);
  }
  for (const rel of Object.keys(bundle.files ?? {})) {
    console.log(rel);
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);
  const flagValue = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    if (command === 'init') {
      const target = rest[0];
      if (!target) throw new Error('usage: logicpkg init <dir> [--name <id>]');
      cmdInit(target, flagValue('--name') ?? 'my-library');
    } else if (command === 'pack') {
      const dir = rest[0];
      const out = flagValue('-o') ?? flagValue('--output');
      if (!dir || !out) throw new Error('usage: logicpkg pack <dir> -o <out.lpkg>');
      cmdPack(dir, out);
    } else if (command === 'install') {
      const pkg = rest[0];
      const target = flagValue('--dir');
      if (!pkg || !target) {
        throw new Error('usage: logicpkg install <pkg.lpkg> --dir <target>');
      }
      cmdInstall(pkg, target);
    } else if (command === 'list') {
      if (!rest[0]) throw new Error('usage: logicpkg list <pkg.lpkg>');
      cmdList(rest[0]);
    } else {
      throw new Error('unknown command (init|pack|install|list)');
    }
  } catch (error) {
    console.error(`logicpkg: ${error.message}`);
    process.exit(1);
  }
}

main();
