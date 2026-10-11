import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const wit = readFileSync(new URL('schemas/wasm/logicpilot-plugin.wit', root), 'utf8');
const required = [
  'package logicpilot:plugin@1.0.0;',
  'interface host-log',
  'interface host-random',
  'interface host-service',
  'invoke: func',
  'log: func',
  'random-u32: func',
  'export logicpilot-abi-version: func',
  'world plugin',
  'import host-service;',
  'export activate: func',
  'export deactivate: func',
];
const missing = required.filter((needle) => !wit.includes(needle));
if (missing.length > 0) throw new Error(`WIT contract is incomplete: ${missing.join(', ')}`);
console.log('[wit-contract] OK: logicpilot:plugin@1.0.0 host/lifecycle/service world');
