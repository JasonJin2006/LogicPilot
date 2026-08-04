# Schema conformance gate for the frozen contracts F1 (schemas/ir_v2.fbs) and
# F2 (schemas/wire.fbs), see ADR-0004.
#
# Two gates per schema:
#   1. `flatc --conform schemas/baseline/<s> <current>` - fails when field
#      ids moved or became incompatible with the frozen baseline.
#   2. binary schema (.bfbs) byte comparison - catches any other drift
#      (field removal, renames, type changes, new fields) since the freeze.
#
# Updating the freeze is an explicit, reviewed act: copy the new schema over
# schemas/baseline/<name>.fbs in the same commit that changes the contract.
#
# Usage:
#   pwsh scripts/check-schema-conform.ps1
# Exit code 0 = conformant, 1 = violation.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
        $schemas = @('ir_v2.fbs', 'wire.fbs')

# --- locate flatc (env > .deps download > PATH) -----------------------------
function Get-Flatc {
    foreach ($envVar in @('FLATC', 'FLATC_EXECUTABLE')) {
        $val = [Environment]::GetEnvironmentVariable($envVar)
        if ($val -and (Test-Path $val)) { return $val }
    }
    $exe = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'flatc.exe' } else { 'flatc' }
    $deps = Join-Path (Join-Path $root '.deps') "flatc/$exe"
    if (Test-Path $deps) { return $deps }
    $cmd = Get-Command flatc -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # Last resort: download the pinned prebuilt binary (gitignored .deps/).
    & (Join-Path $root 'scripts\fetch-flatc.ps1')
    if (Test-Path $deps) { return $deps }
    throw 'flatc not found'
}

$flatc = Get-Flatc
Write-Host "Using flatc: $flatc"
& $flatc --version

$tmp = Join-Path (Join-Path $root 'build') 'conform-check'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$failed = $false
foreach ($schema in $schemas) {
    $baseline = Join-Path $root "schemas/baseline/$schema"
    $current = Join-Path $root "schemas/$schema"
    if (-not (Test-Path $baseline)) {
        Write-Error "missing baseline: $baseline"
        $failed = $true
        continue
    }

    # Gate 1: --conform rejects incompatible field-id changes vs the baseline.
    $genOut = Join-Path $tmp "$schema.cpp-out"
    New-Item -ItemType Directory -Force -Path $genOut | Out-Null
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $conformOutput = & $flatc --conform $baseline --cpp -o $genOut $current 2>&1
    $conformExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($conformExit -ne 0) {
        $conformOutput | ForEach-Object { Write-Host "    $_" }
        Write-Error "[$schema] NOT conformant: field ids are incompatible with schemas/baseline/$schema"
        $failed = $true
        continue
    }

    # Gate 2: exact binary-schema comparison (any drift since the freeze).
    $bfbsBase = Join-Path $tmp "$schema.base"
    $bfbsCur = Join-Path $tmp "$schema.cur"
    New-Item -ItemType Directory -Force -Path $bfbsBase, $bfbsCur | Out-Null
    & $flatc -b --schema -o $bfbsBase $baseline
    if ($LASTEXITCODE -ne 0) { throw "failed compiling baseline $schema" }
    & $flatc -b --schema -o $bfbsCur $current
    if ($LASTEXITCODE -ne 0) { throw "failed compiling current $schema" }
    $baseHash = (Get-FileHash (Join-Path $bfbsBase $schema.Replace('.fbs', '.bfbs')) -Algorithm SHA256).Hash
    $curHash = (Get-FileHash (Join-Path $bfbsCur $schema.Replace('.fbs', '.bfbs')) -Algorithm SHA256).Hash
    if ($baseHash -ne $curHash) {
        Write-Error "[$schema] drifted from schemas/baseline/$schema (binary schema mismatch). Update the baseline only via a reviewed freeze change."
        $failed = $true
        continue
    }

    Write-Host "[$schema] conform OK"
}

if ($failed) {
    Write-Host 'SCHEMA CONFORM: FAIL'
    exit 1
}
Write-Host 'SCHEMA CONFORM: PASS'
exit 0
