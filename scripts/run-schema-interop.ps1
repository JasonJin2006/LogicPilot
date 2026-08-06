# One-click C++/TS schema interop test for contracts F1 (ir_v2.fbs) + F2
# (wire.fbs). Callable from CI.
#
# Pipeline:
#   1. ensure flatc (.deps/flatc download, see scripts/fetch-flatc.ps1)
#   2. TS codegen -> web/packages/protocol/src/generated
#   3. pnpm install + build the @logicpilot/protocol package (tsc)
#   4. configure + build the standalone C++ writer (scripts/interop), which
#      pulls ONLY the flatbuffers vcpkg port
#   5. run the writer to produce model_v2.bin + counters_frame.bin
#   6. verify both buffers with the TypeScript runtime (117 field checks)
#
# Usage:
#   pwsh scripts/run-schema-interop.ps1
# Environment overrides: CMAKE, NINJA, FLATC, VCPKG_ROOT, CXX compiler via
# CMAKE_CXX_COMPILER.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Tool([string]$name, [string[]]$fallbackPaths) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in $fallbackPaths) {
        if (Test-Path $p) { return $p }
    }
    throw "$name not found on PATH and no fallback matched ($($fallbackPaths -join ', '))"
}

# MinGW runtime must be on PATH for the GCC-built writer (Windows dev boxes).
if (Test-Path 'C:\msys64\ucrt64\bin') {
    $env:PATH = 'C:\msys64\ucrt64\bin;' + $env:PATH
}

$cmake = if ($env:CMAKE) { $env:CMAKE } else {
    Find-Tool 'cmake' @('C:\Program Files\CMake\bin\cmake.exe')
}
$ninja = if ($env:NINJA) { $env:NINJA } else {
    Find-Tool 'ninja' @(Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ninja-build.Ninja_*\ninja.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
}
# setup-ninja can expose ninja through a relative PATH entry (ninja_bin/ninja).
# CMAKE_MAKE_PROGRAM must be absolute: CMake resolves a relative path against
# the build directory (build/interop), where the binary does not exist.
if ($ninja -and -not [System.IO.Path]::IsPathRooted($ninja)) {
    $ninja = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $ninja))
}
if (-not $env:VCPKG_ROOT -and (Test-Path (Join-Path $root '.deps\vcpkg\vcpkg.exe'))) {
    $env:VCPKG_ROOT = Join-Path $root '.deps\vcpkg'
}

Write-Host '==> [1/6] ensure flatc'
& (Join-Path $root 'scripts\fetch-flatc.ps1')

Write-Host '==> [2/6] TypeScript codegen'
node (Join-Path $root 'scripts\codegen-ts.mjs')
if ($LASTEXITCODE -ne 0) { throw 'TS codegen failed' }

Write-Host '==> [3/6] pnpm install + build @logicpilot/protocol'
# pnpm is invoked through corepack (pinned by "packageManager" in package.json).
corepack pnpm@9.15.0 install
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
corepack pnpm@9.15.0 --filter '@logicpilot/protocol' run build
if ($LASTEXITCODE -ne 0) { throw 'protocol build (tsc) failed' }

Write-Host '==> [4/6] configure + build C++ writer (scripts/interop)'
if (-not $env:VCPKG_ROOT) { throw 'VCPKG_ROOT is not set and .deps/vcpkg is missing' }
$buildDir = Join-Path $root 'build\interop'
$configureArgs = @(
    '-S', (Join-Path $root 'scripts\interop'),
    '-B', $buildDir,
    '-G', 'Ninja',
    "-DCMAKE_MAKE_PROGRAM=$ninja",
    "-DCMAKE_TOOLCHAIN_FILE=$($env:VCPKG_ROOT.Replace('\','/'))/scripts/buildsystems/vcpkg.cmake",
    '-DCMAKE_BUILD_TYPE=Release'
)
if ($env:CMAKE_CXX_COMPILER) { $configureArgs += "-DCMAKE_CXX_COMPILER=$env:CMAKE_CXX_COMPILER" }
elseif (Test-Path 'C:/msys64/ucrt64/bin/g++.exe') { $configureArgs += '-DCMAKE_CXX_COMPILER=C:/msys64/ucrt64/bin/g++.exe' }
& $cmake @configureArgs
if ($LASTEXITCODE -ne 0) { throw 'cmake configure (interop) failed' }
& $cmake --build $buildDir
if ($LASTEXITCODE -ne 0) { throw 'cmake build (interop) failed' }

Write-Host '==> [5/6] run schema_interop_writer'
$writer = Join-Path $buildDir 'schema_interop_writer'
if ($IsWindows -or $env:OS -eq 'Windows_NT') { $writer += '.exe' }
$outDir = Join-Path $buildDir 'interop-out'
& $writer $outDir
if ($LASTEXITCODE -ne 0) { throw 'schema_interop_writer failed' }

Write-Host '==> [6/6] verify buffers with the TypeScript runtime'
node (Join-Path $root 'web\packages\protocol\test\verify-interop.mjs') $outDir
if ($LASTEXITCODE -ne 0) { throw 'verify-interop failed' }

Write-Host ''
Write-Host 'SCHEMA INTEROP: PASS (C++ writer -> FlatBuffers -> TS verifier)'
