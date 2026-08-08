import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { findLpcli, findLpServer, NATIVE_BUILD_DIRS } from './tool-paths.mjs';

assert.ok(NATIVE_BUILD_DIRS.includes('windows-msvc-dev'));
assert.ok(NATIVE_BUILD_DIRS.includes('architecture-verify'));
const resolved = findLpcli();
if (resolved !== 'lpcli') assert.equal(existsSync(resolved), true);
const server = findLpServer();
assert.ok(server && existsSync(server), `lp-server not found: ${server}`);
console.log(`TOOL-PATHS TEST: PASS (${resolved}; ${server})`);
