import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const host =
  process.argv[2] ??
  join(
    process.cwd(),
    'build',
    process.platform === 'win32' ? 'windows-msvc-dev' : 'linux-gcc-dev',
    'kernel',
    process.platform === 'win32' ? 'lp-session-host.exe' : 'lp-session-host',
  );
assert.ok(existsSync(host), 'session host not found: ' + host);
const child = spawn(host, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
const reader = createInterface({ input: child.stdout });
const pending = new Map();
reader.on('line', (line) => {
  const value = JSON.parse(line);
  pending.get(value.id)?.(value);
  pending.delete(value.id);
});
let nextId = 1;
function request(kind, fields = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('session host command timed out: ' + kind));
    }, 20_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.stdin.write(JSON.stringify({ id, kind, ...fields }) + '\n');
  });
}
try {
  const hello = await request('hello');
  assert.equal(hello.protocol, 'logicpilot.native-session/v1');
  assert.equal(hello.version, 1);
  const dsl = readFileSync(join(process.cwd(), 'examples', 'mm1.lp'), 'utf8');
  const started = await request('start', { dsl, seed: 7, arrivals: 10, warmup: 0 });
  assert.equal(started.ok, true, JSON.stringify(started));
  const stepped = await request('step', { events: 1 });
  assert.equal(stepped.ok, true, JSON.stringify(stepped));
  assert.equal(stepped.dispatched, 1);
  const aborted = await request('abort');
  assert.equal(aborted.ok, true);
  assert.equal(aborted.state, 'cancelled');

  const restarted = await request('start', { dsl, seed: 7, arrivals: 10, warmup: 0 });
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  const finished = await request('finish');
  assert.equal(finished.ok, true, JSON.stringify(finished));
  assert.equal(finished.state, 'completed');
  assert.equal(Array.isArray(finished.metrics), true);
  await request('shutdown');
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('exit ' + code))));
    child.once('error', reject);
  });
  console.log('SESSION-HOST TEST: PASS');
} catch (error) {
  child.kill();
  throw new Error(error.message + (stderr ? '\n' + stderr : ''));
}
