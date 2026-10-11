// Keep Ninja's dependency parser independent of the MSVC language pack/codepage.
// VSLANG=1033 can still produce GBK Chinese on installations without English resources.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function normalizeCompilerOutput(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('gb18030').decode(buffer);
  }
  return text.replace(/^注意: 包含文件:/gm, 'Note: including file:');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [compiler, ...args] = process.argv.slice(2);
  const result = spawnSync(compiler, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(normalizeCompilerOutput(result.stdout));
  if (result.stderr) process.stderr.write(normalizeCompilerOutput(result.stderr));
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  process.exitCode = result.status ?? 1;
}
