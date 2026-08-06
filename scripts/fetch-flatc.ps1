# Fetches a prebuilt flatc compiler into .deps/flatc/ (gitignored).
#
# Two supported ways to obtain flatc in this repo (see cmake/codegen.cmake):
#   1. vcpkg: the flatbuffers port installs flatc under
#      $env:VCPKG_ROOT/installed/<triplet>/tools/flatbuffers/ (or the build
#      tree's vcpkg_installed/<triplet>/tools/flatbuffers/).
#   2. This script: downloads the official prebuilt binary from the
#      google/flatbuffers GitHub Releases into .deps/flatc/ (fast, no vcpkg
#      build required). .deps/ is gitignored; nothing prebuilt is committed.
#
# Usage:
#   pwsh scripts/fetch-flatc.ps1 [-Version v25.9.23] [-Force]
#
# The pinned version MUST stay in sync with the `flatbuffers` npm runtime in
# web/packages/protocol/package.json (TS codegen compatibility).

[CmdletBinding()]
param(
    [string]$Version = 'v25.9.23',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path (Join-Path $root '.deps') 'flatc'

function Get-FlatcPath {
    if ($IsWindows -or $env:OS -eq 'Windows_NT') { return Join-Path $destDir 'flatc.exe' }
    return Join-Path $destDir 'flatc'
}

$flatc = Get-FlatcPath
if ((Test-Path $flatc) -and -not $Force) {
    Write-Host "flatc already present: $flatc"
    exit 0
}

$isWin = $IsWindows -or ($env:OS -eq 'Windows_NT')
if ($isWin) {
    $asset = 'Windows.flatc.binary.zip'
} elseif ($IsLinux) {
    $asset = 'Linux.flatc.binary.g++-13.zip'
} elseif ($IsMacOS) {
    $asset = 'Mac.flatc.binary.zip'
} else {
    throw 'Unsupported platform for flatc download; install flatbuffers via vcpkg instead.'
}

$url = "https://github.com/google/flatbuffers/releases/download/$Version/$asset"
# GitHub Actions Linux runners do not set $env:TEMP; use the platform temp
# directory so the download path works on every runner OS.
$tempDir = [System.IO.Path]::GetTempPath()
$zip = Join-Path $tempDir "flatc-$Version-$asset"

Write-Host "Downloading $url"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extracting to $destDir"
Expand-Archive -Path $zip -DestinationPath $destDir -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue

# Some archives nest the binary in a subfolder; hoist it if needed.
if (-not (Test-Path $flatc)) {
    $nested = Get-ChildItem -Path $destDir -Recurse -Filter (Split-Path $flatc -Leaf) | Select-Object -First 1
    if ($null -ne $nested) { Move-Item $nested.FullName $flatc -Force }
}

if (-not (Test-Path $flatc)) { throw "flatc download failed (expected $flatc)" }
if (-not $isWin) { & chmod +x $flatc }

Write-Host "flatc ready: $flatc"
# Pipe to Out-Host so the version banner never leaks into the caller's
# pipeline: callers invoke this script with `&` and PowerShell would
# otherwise treat every emitted line as the script's return value.
& $flatc --version | Out-Host
