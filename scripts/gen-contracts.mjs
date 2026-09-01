#!/usr/bin/env node
// Phase 1 contract codegen (docs/architecture/next-generation-plugin-platform.md §16).
//
// schemas/contracts/*.schema.json is the single source of truth. This script
// walks every $defs entry and deterministically generates:
//   - web/packages/contracts/src/generated/contracts.ts   (types)
//   - web/packages/contracts/src/generated/schemas.ts     (schema payloads for ajv)
//   - kernel/include/logicpilot/contracts/contracts_generated.h
//   - kernel/src/contracts/contracts_generated.cpp        (strict parse: unknown
//     fields rejected, const/version fields enforced; dump; equality)
//
// Supported schema subset (keep contracts generator-friendly):
//   objects whose properties are $ref | primitive | const | array | map
//   (inline nested objects are forbidden; use named $defs entries), string
//   enums, string/integer consts, and free-form JSON marked with
//   "x-freeform-json": true.
//
// Run: node scripts/gen-contracts.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schemas', 'contracts');
const tsOut = join(root, 'web', 'packages', 'contracts', 'src', 'generated');
const cppHeaderOut = join(root, 'kernel', 'include', 'logicpilot', 'contracts');
const cppSrcOut = join(root, 'kernel', 'src', 'contracts');

// ---------------------------------------------------------------------------
// Load schemas and build the global definition table.
// ---------------------------------------------------------------------------

const schemaFiles = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.schema.json'))
  .sort();
if (schemaFiles.length === 0) throw new Error('no schemas found');

const schemas = new Map(); // fileName -> parsed schema
const defs = new Map(); // defName -> { name, file, def }
for (const file of schemaFiles) {
  const parsed = JSON.parse(readFileSync(join(schemaDir, file), 'utf8'));
  schemas.set(file, parsed);
  for (const [name, def] of Object.entries(parsed.$defs ?? {})) {
    if (defs.has(name)) throw new Error(`duplicate definition name across files: ${name}`);
    defs.set(name, { name, file, def });
  }
}

function resolveRef(ref, fromFile) {
  let file = fromFile;
  let path = ref;
  const hash = ref.indexOf('#');
  if (hash >= 0) {
    const filePart = ref.slice(0, hash);
    if (filePart) file = filePart;
    path = ref.slice(hash + 1);
  }
  if (!path.startsWith('/$defs/')) throw new Error(`unsupported $ref path: ${ref}`);
  const name = path.slice('/$defs/'.length);
  if (!defs.has(name)) throw new Error(`unknown definition ${name} referenced from ${fromFile}`);
  return name;
}

// ---------------------------------------------------------------------------
// TS generation
// ---------------------------------------------------------------------------

function tsTypeOf(schema, fromFile) {
  if (schema.$ref) return resolveRef(schema.$ref, fromFile);
  if (schema['x-freeform-json']) return 'JsonValue';
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `ReadonlyArray<${tsTypeOf(schema.items, fromFile)}>`;
    case 'object':
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `{ readonly [key: string]: ${tsTypeOf(schema.additionalProperties, fromFile)} }`;
      }
      throw new Error('inline object properties are not allowed; use a named $defs entry');
    default:
      throw new Error(`unsupported schema in TS generation: ${JSON.stringify(schema).slice(0, 120)}`);
  }
}

function generateTs() {
  const lines = [];
  lines.push('// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs');
  lines.push('// Source of truth: schemas/contracts/*.schema.json (Phase 1 contract freeze).');
  lines.push('');
  lines.push('export type JsonValue =');
  lines.push('  | null');
  lines.push('  | boolean');
  lines.push('  | number');
  lines.push('  | string');
  lines.push('  | JsonValue[]');
  lines.push('  | { readonly [key: string]: JsonValue };');
  lines.push('');
  for (const { name, file, def } of defs.values()) {
    if (name === 'JsonValue') continue; // base type emitted once above
    lines.push(`// --- ${name} (${file}) ---`);
    if (def['x-freeform-json']) {
      lines.push(`export type ${name} = JsonValue;`);
    } else if (def.type === 'string' && def.enum) {
      lines.push(`export type ${name} = ${def.enum.map((v) => JSON.stringify(v)).join(' | ')};`);
    } else if (def.type === 'string') {
      lines.push(`export type ${name} = string;`);
    } else if (def.type === 'object') {
      lines.push(`export interface ${name} {`);
      for (const [key, prop] of Object.entries(def.properties ?? {})) {
        const optional = !(def.required ?? []).includes(key) ? '?' : '';
        lines.push(`  readonly ${key}${optional}: ${tsTypeOf(prop, file)};`);
      }
      lines.push('}');
    } else {
      throw new Error(`unsupported def kind for ${name}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// C++ generation
// ---------------------------------------------------------------------------

const CPP20_KEYWORD_FIELDS = new Set(['requires', 'co_await', 'co_return', 'co_yield']);

function camelToSnake(key) {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return CPP20_KEYWORD_FIELDS.has(snake) ? snake + '_' : snake;
}

function cppEnumValue(value) {
  const words = String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `k${words}`;
}

function cppTypeOfField(schema, fromFile) {
  if (schema.$ref) {
    const name = resolveRef(schema.$ref, fromFile);
    const target = defs.get(name).def;
    if (target['x-freeform-json']) return { type: name, freeform: true };
    if (target.type === 'object') return { type: name, struct: true };
    if (target.type === 'string' && target.enum) return { type: name, enum: true };
    if (target.type === 'string') return { type: 'std::string' };
    throw new Error(`unsupported $ref target for C++: ${name}`);
  }
  if (schema['x-freeform-json']) return { type: 'nlohmann::ordered_json', freeform: true };
  if (schema.const !== undefined) {
    if (typeof schema.const === 'string') return { type: 'std::string' };
    return { type: 'std::int64_t' };
  }
  switch (schema.type) {
    case 'string':
      return { type: 'std::string' };
    case 'integer':
      return { type: 'std::int64_t' };
    case 'number':
      return { type: 'double' };
    case 'boolean':
      return { type: 'bool' };
    case 'array': {
      const el = cppTypeOfField(schema.items, fromFile);
      if (el.mapValue) throw new Error('arrays of maps are not supported');
      return { type: `std::vector<${el.type}>`, element: el };
    }
    case 'object': {
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const val = cppTypeOfField(schema.additionalProperties, fromFile);
        if (val.mapValue) throw new Error('maps of maps are not supported');
        return { type: `std::map<std::string, ${val.type}>`, mapValue: val };
      }
      throw new Error('inline object properties are not allowed; use a named $defs entry');
    }
    default:
      throw new Error(`unsupported schema in C++ generation: ${JSON.stringify(schema).slice(0, 120)}`);
  }
}

function cppStringLiteral(value) {
  return JSON.stringify(String(value));
}

/** Dependency-ordered struct names: direct members require complete types. */
function topoSortStructs() {
  const structs = [...defs.values()]
    .filter(({ def }) => def.type === 'object' && !def['x-freeform-json'])
    .map(({ name }) => name);
  const structSet = new Set(structs);
  const deps = new Map(structs.map((name) => [name, new Set()]));
  for (const { name, file, def } of defs.values()) {
    if (def.type !== 'object' || def['x-freeform-json']) continue;
    const own = deps.get(name);
    for (const prop of Object.values(def.properties ?? {})) {
      const info = cppTypeOfField(prop, file);
      for (const candidate of [info, info.element, info.mapValue]) {
        if (candidate?.struct && structSet.has(candidate.type)) own.add(candidate.type);
      }
    }
  }
  const sorted = structs.slice().sort();
  const order = [];
  const emitted = new Set();
  let progress = true;
  while (order.length < structs.length && progress) {
    progress = false;
    for (const name of sorted) {
      if (emitted.has(name)) continue;
      const pending = [...deps.get(name)].filter((dep) => !emitted.has(dep));
      if (pending.length === 0) {
        order.push(name);
        emitted.add(name);
        progress = true;
      }
    }
  }
  if (order.length !== structs.length) {
    const remaining = sorted.filter((name) => !emitted.has(name));
    throw new Error(`schema dependency cycle among structs: ${remaining.join(', ')}`);
  }
  return order;
}

function generateCppHeader() {
  const h = [];
  h.push('// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs');
  h.push('// Source of truth: schemas/contracts/*.schema.json (Phase 1 contract freeze).');
  h.push('// Parsing is strict: unknown fields are rejected and const/version fields are');
  h.push('// enforced. Full JSON Schema validation (patterns, bounds) runs on the TS side.');
  h.push('#pragma once');
  h.push('');
  h.push('#include <cstdint>');
  h.push('#include <map>');
  h.push('#include <optional>');
  h.push('#include <string>');
  h.push('#include <string_view>');
  h.push('#include <vector>');
  h.push('');
  h.push('#include <nlohmann/json.hpp>');
  h.push('');
  h.push('namespace logicpilot::contracts {');
  h.push('');
  h.push('// Any JSON value; used for opaque structured payloads.');
  h.push('using JsonValue = nlohmann::ordered_json;');
  h.push('');

  // 1. Enums (no interdependencies).
  for (const { name, def } of defs.values()) {
    if (name === 'JsonValue') continue;
    if (def['x-freeform-json'] || def.type !== 'string' || !def.enum) continue;
    h.push(`enum class ${name} : std::uint8_t {`);
    for (const v of def.enum) h.push(`  ${cppEnumValue(v)},`);
    h.push('};');
    h.push('');
    h.push(`[[nodiscard]] std::string dump(${name} value);`);
    h.push(`[[nodiscard]] bool parse(std::string_view text, ${name}& out, std::string& error);`);
    h.push(`[[nodiscard]] nlohmann::ordered_json to_json(${name} value);`);
    h.push('');
  }

  // 2. String aliases + named free-form payload aliases.
  for (const { name, def } of defs.values()) {
    if (name === 'JsonValue') continue;
    if (def['x-freeform-json']) {
      h.push(`using ${name} = JsonValue;`);
      continue;
    }
    if (def.type !== 'string' || def.enum) continue;
    h.push(`using ${name} = std::string;`);
  }
  h.push('');

  // 3. Forward declarations for all structs.
  for (const { name, def } of defs.values()) {
    if (def.type !== 'object' || def['x-freeform-json']) continue;
    h.push(`struct ${name};`);
  }
  h.push('');

  // 4. Struct definitions + function declarations. Definitions are emitted in
  // dependency order (direct members need complete types; forward declarations
  // only cover vector/optional/map members).
  const structOrder = topoSortStructs();
  for (const name of structOrder) {
    const { file, def } = defs.get(name);
    h.push(`// ${file}`);
    h.push(`struct ${name} {`);
    for (const [key, prop] of Object.entries(def.properties ?? {})) {
      const info = cppTypeOfField(prop, file);
      const optional = !(def.required ?? []).includes(key);
      const type = optional ? `std::optional<${info.type}>` : info.type;
      h.push(`  ${type} ${camelToSnake(key)};`);
    }
    h.push('};');
    h.push('');
    h.push(`[[nodiscard]] bool operator==(const ${name}& lhs, const ${name}& rhs);`);
    h.push(`[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ${name}& out, std::string& error);`);
    h.push(`[[nodiscard]] bool parse(std::string_view text, ${name}& out, std::string& error);`);
    h.push(`[[nodiscard]] nlohmann::ordered_json to_json(const ${name}& value);`);
    h.push(`[[nodiscard]] std::string dump(const ${name}& value);`);
    h.push('');
  }

  h.push('}  // namespace logicpilot::contracts');
  h.push('');
  return h.join('\n');
}

function generateCppSource() {
  const s = [];
  s.push('// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs');
  s.push('#include "logicpilot/contracts/contracts_generated.h"');
  s.push('');
  s.push('#include <stdexcept>');
  s.push('#include <utility>');
  s.push('');
  s.push('namespace logicpilot::contracts {');
  s.push('');
  s.push('namespace {');
  s.push('');
  s.push('[[noreturn]] void fail_missing(std::string& error, const std::string& path, const char* key) {');
  s.push("  error = path + \": missing required field '\" + key + \"'\";");
  s.push('  throw std::runtime_error(error);');
  s.push('}');
  s.push('');
  s.push('const nlohmann::ordered_json& field_or_fail(std::string& error, const nlohmann::ordered_json& j,');
  s.push('                                            const char* key, const std::string& path) {');
  s.push('  auto it = j.find(key);');
  s.push("  if (it == j.end()) fail_missing(error, path, key);");
  s.push('  return *it;');
  s.push('}');
  s.push('');
  s.push('nlohmann::ordered_json to_json_value(const std::string& v) { return nlohmann::ordered_json(v); }');
  s.push('nlohmann::ordered_json to_json_value(std::int64_t v) { return nlohmann::ordered_json(v); }');
  s.push('nlohmann::ordered_json to_json_value(double v) { return nlohmann::ordered_json(v); }');
  s.push('nlohmann::ordered_json to_json_value(bool v) { return nlohmann::ordered_json(v); }');
  s.push('nlohmann::ordered_json to_json_value(const JsonValue& v) { return v; }');
  // Exact forwarding overloads for every enum / struct contract type. Vector
  // and map helpers below resolve element conversions via ordinary lookup at
  // their definition point, so a generic template would be missed by MSVC's
  // dependent-name resolution here.
  for (const { name, def } of defs.values()) {
    if (def.type === 'string' && def.enum) {
      s.push(`nlohmann::ordered_json to_json_value(${name} v) { return to_json(v); }`);
    }
  }
  for (const { name, def } of defs.values()) {
    if (def.type === 'object' && !def['x-freeform-json']) {
      s.push(`nlohmann::ordered_json to_json_value(const ${name}& v) { return to_json(v); }`);
    }
  }
  s.push('template <typename T>');
  s.push('nlohmann::ordered_json to_json_value(const std::vector<T>& v) {');
  s.push('  auto arr = nlohmann::ordered_json::array();');
  s.push('  for (const auto& item : v) arr.push_back(to_json_value(item));');
  s.push('  return arr;');
  s.push('}');
  s.push('template <typename T>');
  s.push('nlohmann::ordered_json to_json_value(const std::map<std::string, T>& v) {');
  s.push('  auto obj = nlohmann::ordered_json::object();');
  s.push('  for (const auto& [key, value] : v) obj[key] = to_json_value(value);');
  s.push('  return obj;');
  s.push('}');
  s.push('');
  s.push('}  // namespace');
  s.push('');

  // Enum bodies.
  for (const { name, def } of defs.values()) {
    if (def.type !== 'string' || !def.enum) continue;
    s.push(`std::string dump(${name} value) {`);
    s.push('  switch (value) {');
    for (const v of def.enum) {
      s.push(`    case ${name}::${cppEnumValue(v)}: return ${cppStringLiteral(v)};`);
    }
    s.push('  }');
    s.push(`  return "<invalid ${name}>";`);
    s.push('}');
    s.push('');
    s.push(`bool parse(std::string_view text, ${name}& out, std::string& error) {`);
    s.push(`  static const std::pair<std::string_view, ${name}> kTable[] = {`);
    for (const v of def.enum) {
      s.push(`      {${cppStringLiteral(v)}, ${name}::${cppEnumValue(v)}},`);
    }
    s.push('  };');
    s.push('  for (const auto& [label, parsed] : kTable) {');
    s.push('    if (text == label) {');
    s.push('      out = parsed;');
    s.push('      return true;');
    s.push('    }');
    s.push('  }');
    s.push(`  error = "invalid ${name} value: " + std::string(text);`);
    s.push('  return false;');
    s.push('}');
    s.push('');
    s.push(`nlohmann::ordered_json to_json(${name} value) { return nlohmann::ordered_json(dump(value)); }`);
    s.push('');
  }

  // Struct bodies.
  for (const { name, file, def } of defs.values()) {
    if (def.type !== 'object' || def['x-freeform-json']) continue;
    emitStructBody(s, name, file, def);
  }

  s.push('}  // namespace logicpilot::contracts');
  s.push('');
  return s.join('\n');
}

function emitStructBody(s, name, file, def) {
  const required = new Set(def.required ?? []);
  const fields = Object.entries(def.properties ?? {}).map(([key, prop]) => ({
    key,
    snake: camelToSnake(key),
    optional: !required.has(key),
    info: cppTypeOfField(prop, file),
    prop,
  }));

  // parse (object form)
  s.push(`bool parse_json(const nlohmann::ordered_json& j, ${name}& out, std::string& error) {`);
  s.push('  if (!j.is_object()) {');
  s.push(`    error = "expected object for ${name}";`);
  s.push('    return false;');
  s.push('  }');
  s.push('  static const char* const kKnownFields[] = {');
  for (const f of fields) s.push(`      "${f.key}",`);
  s.push('  };');
  s.push('  for (auto it = j.begin(); it != j.end(); ++it) {');
  s.push('    bool known = false;');
  s.push('    for (const char* k : kKnownFields) {');
  s.push('      if (it.key() == k) { known = true; break; }');
  s.push('    }');
  s.push('    if (!known) {');
  s.push(`      error = "${name}: unknown field \'" + it.key() + "\'";`);
  s.push('      return false;');
  s.push('    }');
  s.push('  }');
  for (const f of fields) {
    const failPath = `std::string("${name}.${f.key}")`;
    if (f.optional) {
      s.push('  {');
      s.push(`    auto field_it = j.find("${f.key}");`);
      s.push('    if (field_it != j.end()) {');
      s.push(`      ${f.info.type} parsed{};`);
      emitFieldParse(s, f, '(*field_it)', 'parsed', failPath);
      s.push(`      out.${f.snake} = std::move(parsed);`);
      s.push('    }');
      s.push('  }');
    } else {
      s.push('  {');
      s.push(`    const auto& value = field_or_fail(error, j, "${f.key}", "${name}");`);
      emitFieldParse(s, f, 'value', `out.${f.snake}`, failPath);
      s.push('  }');
    }
  }
  s.push('  (void)error;');
  s.push('  return true;');
  s.push('}');
  s.push('');

  // parse (text form)
  s.push(`bool parse(std::string_view text, ${name}& out, std::string& error) {`);
  s.push('  try {');
  s.push('    const auto j = nlohmann::ordered_json::parse(text);');
  s.push('    return parse_json(j, out, error);');
  s.push('  } catch (const std::exception& ex) {');
  s.push('    error = ex.what();');
  s.push('    return false;');
  s.push('  }');
  s.push('}');
  s.push('');

  // to_json
  s.push(`nlohmann::ordered_json to_json(const ${name}& value) {`);
  s.push('  nlohmann::ordered_json j = nlohmann::ordered_json::object();');
  for (const f of fields) {
    const valueExpr = f.optional ? `*value.${f.snake}` : `value.${f.snake}`;
    if (f.optional) {
      s.push(`  if (value.${f.snake}.has_value()) {`);
      emitFieldDump(s, f, valueExpr);
      s.push('  }');
    } else {
      emitFieldDump(s, f, valueExpr);
    }
  }
  s.push('  return j;');
  s.push('}');
  s.push('');

  // dump
  s.push(`std::string dump(const ${name}& value) { return to_json(value).dump(2); }`);
  s.push('');

  // operator==
  s.push(`bool operator==(const ${name}& lhs, const ${name}& rhs) {`);
  if (fields.length === 0) {
    s.push('  (void)lhs;');
    s.push('  (void)rhs;');
    s.push('  return true;');
  } else {
    const comparisons = fields.map((f) => {
      // Free-form JSON payloads (nlohmann::ordered_json) are compared via
      // their serialized form; MSVC cannot resolve the templated == through
      // std::optional<basic_json>.
      if (f.info.freeform) {
        if (f.optional) {
          return `(lhs.${f.snake}.has_value() == rhs.${f.snake}.has_value()\n      && (!lhs.${f.snake}.has_value() || lhs.${f.snake}->dump() == rhs.${f.snake}->dump()))`;
        }
        return `lhs.${f.snake}.dump() == rhs.${f.snake}.dump()`;
      }
      return `lhs.${f.snake} == rhs.${f.snake}`;
    });
    s.push('  return ' + comparisons.join('\n      && ') + ';');
  }
  s.push('}');
  s.push('');
}

function emitFieldParse(s, f, valueExpr, outExpr, failPath) {
  const { info } = f;
  if (info.enum) {
    s.push('      std::string enum_error;');
    s.push(`      if (!parse(${valueExpr}.get<std::string>(), ${outExpr}, enum_error)) {`);
    s.push(`        error = ${failPath} + ": " + enum_error;`);
    s.push('        return false;');
    s.push('      }');
    return;
  }
  if (info.freeform) {
    s.push(`      ${outExpr} = ${valueExpr};`);
    return;
  }
  if (info.type === 'std::string') {
    if (f.prop.const !== undefined) {
      s.push(`      if (!${valueExpr}.is_string() || ${valueExpr}.get<std::string>() != ${cppStringLiteral(f.prop.const)}) {`);
      s.push(`        error = ${failPath} + ": expected constant " + ${cppStringLiteral(f.prop.const)};`);
      s.push('        return false;');
      s.push('      }');
    } else {
      s.push(`      if (!${valueExpr}.is_string()) {`);
      s.push(`        error = ${failPath} + ": expected string";`);
      s.push('        return false;');
      s.push('      }');
    }
    s.push(`      ${outExpr} = ${valueExpr}.get<std::string>();`);
    return;
  }
  if (info.type === 'std::int64_t') {
    if (f.prop.const !== undefined) {
      s.push(`      if (!${valueExpr}.is_number_integer() || ${valueExpr}.get<std::int64_t>() != ${String(f.prop.const)}) {`);
      s.push(`        error = ${failPath} + ": expected constant ${String(f.prop.const)}";`);
      s.push('        return false;');
      s.push('      }');
    } else {
      s.push(`      if (!${valueExpr}.is_number_integer()) {`);
      s.push(`        error = ${failPath} + ": expected integer";`);
      s.push('        return false;');
      s.push('      }');
    }
    s.push(`      ${outExpr} = ${valueExpr}.get<std::int64_t>();`);
    return;
  }
  if (info.type === 'double') {
    s.push(`      if (!${valueExpr}.is_number()) {`);
    s.push(`        error = ${failPath} + ": expected number";`);
    s.push('        return false;');
    s.push('      }');
    s.push(`      ${outExpr} = ${valueExpr}.get<double>();`);
    return;
  }
  if (info.type === 'bool') {
    s.push(`      if (!${valueExpr}.is_boolean()) {`);
    s.push(`        error = ${failPath} + ": expected boolean";`);
    s.push('        return false;');
    s.push('      }');
    s.push(`      ${outExpr} = ${valueExpr}.get<bool>();`);
    return;
  }
  if (info.element) {
    s.push(`      if (!${valueExpr}.is_array()) {`);
    s.push(`        error = ${failPath} + ": expected array";`);
    s.push('        return false;');
    s.push('      }');
    s.push(`      for (const auto& item : ${valueExpr}) {`);
    emitElementParse(s, info.element, 'item', `${outExpr}.emplace_back()`, failPath);
    s.push('      }');
    return;
  }
  if (info.mapValue) {
    s.push(`      if (!${valueExpr}.is_object()) {`);
    s.push(`        error = ${failPath} + ": expected object";`);
    s.push('        return false;');
    s.push('      }');
    s.push(`      for (auto entry_it = ${valueExpr}.begin(); entry_it != ${valueExpr}.end(); ++entry_it) {`);
    emitElementParse(s, info.mapValue, 'entry_it.value()', `${outExpr}[entry_it.key()]`, failPath);
    s.push('      }');
    return;
  }
  if (info.struct) {
    s.push(`      if (!parse_json(${valueExpr}, ${outExpr}, error)) {`);
    s.push(`        error = ${failPath} + ": " + error;`);
    s.push('        return false;');
    s.push('      }');
    return;
  }
  throw new Error(`unsupported field parse for ${f.key}: ${JSON.stringify(info)}`);
}

function emitElementParse(s, info, valueExpr, outExpr, failPath) {
  if (info.enum) {
    s.push('        std::string enum_error;');
    s.push(`        if (!parse(${valueExpr}.get<std::string>(), ${outExpr}, enum_error)) {`);
    s.push(`          error = ${failPath} + ": " + enum_error;`);
    s.push('          return false;');
    s.push('        }');
    return;
  }
  if (info.freeform) {
    s.push(`        ${outExpr} = ${valueExpr};`);
    return;
  }
  if (info.type === 'std::string') {
    s.push(`        if (!${valueExpr}.is_string()) {`);
    s.push(`          error = ${failPath} + ": expected string item";`);
    s.push('          return false;');
    s.push('        }');
    s.push(`        ${outExpr} = ${valueExpr}.get<std::string>();`);
    return;
  }
  if (info.type === 'std::int64_t') {
    s.push(`        if (!${valueExpr}.is_number_integer()) {`);
    s.push(`          error = ${failPath} + ": expected integer item";`);
    s.push('          return false;');
    s.push('        }');
    s.push(`        ${outExpr} = ${valueExpr}.get<std::int64_t>();`);
    return;
  }
  if (info.type === 'double') {
    s.push(`        if (!${valueExpr}.is_number()) {`);
    s.push(`          error = ${failPath} + ": expected number item";`);
    s.push('          return false;');
    s.push('        }');
    s.push(`        ${outExpr} = ${valueExpr}.get<double>();`);
    return;
  }
  if (info.type === 'bool') {
    s.push(`        if (!${valueExpr}.is_boolean()) {`);
    s.push(`          error = ${failPath} + ": expected boolean item";`);
    s.push('          return false;');
    s.push('        }');
    s.push(`        ${outExpr} = ${valueExpr}.get<bool>();`);
    return;
  }
  if (info.struct) {
    s.push(`        if (!parse_json(${valueExpr}, ${outExpr}, error)) {`);
    s.push(`          error = ${failPath} + ": " + error;`);
    s.push('          return false;');
    s.push('        }');
    return;
  }
  throw new Error(`unsupported element parse: ${JSON.stringify(info)}`);
}

function emitFieldDump(s, f, valueExpr) {
  const { info } = f;
  if (info.enum) {
    s.push(`    j["${f.key}"] = to_json(${valueExpr});`);
    return;
  }
  if (info.struct) {
    s.push(`    j["${f.key}"] = to_json(${valueExpr});`);
    return;
  }
  s.push(`    j["${f.key}"] = to_json_value(${valueExpr});`);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

mkdirSync(tsOut, { recursive: true });
mkdirSync(cppHeaderOut, { recursive: true });
mkdirSync(cppSrcOut, { recursive: true });
writeFileSync(join(tsOut, 'contracts.ts'), generateTs());
writeFileSync(join(tsOut, 'schemas.ts'), generateSchemaTs());
writeFileSync(join(tsOut, 'registry.ts'), generateRegistryTs());
writeFileSync(join(cppHeaderOut, 'contracts_generated.h'), generateCppHeader());
writeFileSync(join(cppSrcOut, 'contracts_generated.cpp'), generateCppSource());

function generateRegistryTs() {
  const lines = [];
  lines.push('// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs');
  lines.push('// Name -> TypeScript type registry for validation entry points.');
  lines.push("import type * as C from './contracts.js';");
  lines.push('');
  lines.push('export interface ContractTypes {');
  for (const { name, def } of defs.values()) {
    if (def.type === 'object' || def['x-freeform-json'] || (def.type === 'string' && def.enum)) {
      lines.push(`  ${name}: C.${name};`);
    } else if (def.type === 'string') {
      lines.push(`  ${name}: string;`);
    } else {
      throw new Error(`unsupported def kind for registry: ${name}`);
    }
  }
  lines.push('}');
  lines.push('');
  lines.push('export type ContractDefName = keyof ContractTypes;');
  lines.push('');
  return lines.join('\n') + '\n';
}

function generateSchemaTs() {
  const lines = [];
  lines.push('// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs');
  lines.push('// JSON Schema payloads (single source of truth) for ajv-based validation.');
  lines.push("import type { JsonObject } from '../runtime.js';");
  lines.push('');
  lines.push('export interface ContractSchema {');
  lines.push('  readonly file: string;');
  lines.push('  readonly $id: string;');
  lines.push('  readonly schema: JsonObject;');
  lines.push('}');
  lines.push('');
  lines.push('export const CONTRACT_SCHEMAS: readonly ContractSchema[] = [');
  for (const file of schemaFiles) {
    const parsed = schemas.get(file);
    lines.push('  {');
    lines.push(`    file: ${JSON.stringify(file)},`);
    lines.push(`    $id: ${JSON.stringify(parsed.$id)},`);
    lines.push(`    schema: ${JSON.stringify(parsed)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n') + '\n';
}

console.log(`[gen-contracts] ${defs.size} definitions from ${schemaFiles.length} schemas`);
console.log(`[gen-contracts] -> ${join(tsOut, 'contracts.ts')}`);
console.log(`[gen-contracts] -> ${join(tsOut, 'schemas.ts')}`);
console.log(`[gen-contracts] -> ${join(cppHeaderOut, 'contracts_generated.h')}`);
console.log(`[gen-contracts] -> ${join(cppSrcOut, 'contracts_generated.cpp')}`);
