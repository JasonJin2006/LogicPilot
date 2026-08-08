// Shared native-tool discovery for every AI workflow and the desktop app
// server. Keep build-layout knowledge in one place so a maintained build does
// not work in one endpoint while another silently falls back to PATH.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function logicPilotRoot() {
  return process.env.LOGICPILOT_ROOT || join(here, '..');
}

export const NATIVE_BUILD_DIRS = [
  'release',
  'windows-msvc-dev',
  'architecture-verify',
  'codex-verify',
  'integration-dev',
  'local-mingw',
  'local-gcc',
];

function newestBuildTool(relativeParts, executable) {
  const root = logicPilotRoot();
  const candidates = [];
  for (const dir of NATIVE_BUILD_DIRS) {
    const candidate = join(root, 'build', dir, ...relativeParts, executable);
    if (existsSync(candidate)) {
      candidates.push({ path: candidate, modified: statSync(candidate).mtimeMs });
    }
  }
  // Source checkouts commonly contain several build trees. Selecting the
  // newest executable avoids silently pairing current JS with a stale native
  // contract. Packaged builds set an explicit sidecar path instead.
  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.path;
}

export function findLpcli() {
  if (process.env.LPCLI && existsSync(process.env.LPCLI)) return process.env.LPCLI;
  const exe = process.platform === 'win32' ? 'lpcli.exe' : 'lpcli';
  const candidate = newestBuildTool(['kernel', 'apps', 'lpcli'], exe);
  if (candidate) return candidate;
  return 'lpcli';
}

export function findLpServer() {
  if (process.env.LP_SERVER && existsSync(process.env.LP_SERVER)) {
    return process.env.LP_SERVER;
  }
  const exe = process.platform === 'win32' ? 'lp-server.exe' : 'lp-server';
  return newestBuildTool(['kernel'], exe) ?? null;
}

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
}

/**
 * Add development-build DLL locations to PATH. Packaged applications should
 * ship these libraries beside their sidecars and pass explicit tool paths.
 */
export function extendNativeRuntimePath(executable) {
  if (process.platform !== 'win32' || !executable) return;
  const additions = [];
  const normalized = executable.replaceAll('/', '\\');
  const kernelMarker = normalized.toLowerCase().lastIndexOf('\\kernel\\');
  if (kernelMarker >= 0) {
    const buildRoot = normalized.slice(0, kernelMarker);
    const buildRoots = [
      buildRoot,
      ...NATIVE_BUILD_DIRS.map((directory) =>
        join(logicPilotRoot(), 'build', directory)),
    ];
    for (const candidateRoot of buildRoots) {
      for (const triplet of ['x64-windows', 'x64-windows-static']) {
        for (const configuration of ['debug\\bin', 'bin']) {
          const candidate = join(
              candidateRoot, 'vcpkg_installed', triplet, configuration);
          if (existsSync(candidate)) additions.push(candidate);
        }
      }
    }
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const vsRoot = join(programFiles, 'Microsoft Visual Studio', '2022');
  for (const edition of directories(vsRoot)) {
    const redist = join(edition, 'VC', 'Redist', 'MSVC');
    for (const version of directories(redist)) {
      for (const runtime of ['Microsoft.VC143.DebugCRT', 'Microsoft.VC142.DebugCRT']) {
        const candidate = join(version, 'debug_nonredist', 'x64', runtime);
        if (existsSync(candidate)) additions.push(candidate);
      }
    }
  }

  const programFilesX86 = process.env['ProgramFiles(x86)'] ??
      'C:\\Program Files (x86)';
  const kitsRedist = join(programFilesX86, 'Windows Kits', '10', 'Redist');
  for (const version of directories(kitsRedist)) {
    const candidate = join(version, 'ucrt', 'DLLs', 'x64');
    if (existsSync(candidate)) additions.push(candidate);
  }

  const current = (process.env.PATH ?? '').split(';');
  const unique = additions.filter((path) => !current.includes(path));
  if (unique.length > 0) {
    process.env.PATH = `${unique.join(';')};${process.env.PATH ?? ''}`;
  }
}
