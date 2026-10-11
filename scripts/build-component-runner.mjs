import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, 'runtime', 'component-runner', 'target', 'release', process.platform === 'win32' ? 'logicpilot-component-runner.exe' : 'logicpilot-component-runner');
execFileSync('cargo', ['build', '--manifest-path', join(root, 'runtime', 'component-runner', 'Cargo.toml'), '--release'], { cwd: root, stdio: 'inherit' });
if (!existsSync(output)) throw new Error(`component runner build did not produce ${output}`);
console.log(`[component-runner] ${output}`);
