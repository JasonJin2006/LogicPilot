[CmdletBinding()]
param(
  [ValidateSet('windows-msvc-dev', 'windows-msvc-release')]
  [string]$Preset = 'windows-msvc-dev',
  [switch]$Configure,
  [switch]$Clean,
  [switch]$Test
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildDir = Join-Path $repoRoot "build/$Preset"
$cachePath = Join-Path $buildDir 'CMakeCache.txt'

function Find-CachedVisualStudioRoot {
  if (-not (Test-Path $buildDir)) {
    return $null
  }

  $compilerFile = Get-ChildItem -Path (Join-Path $buildDir 'CMakeFiles') `
    -Filter CMakeCXXCompiler.cmake -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $compilerFile) {
    return $null
  }

  $match = Select-String -Path $compilerFile.FullName `
    -Pattern '^set\(CMAKE_CXX_COMPILER "([^"]+)"\)' |
    Select-Object -First 1
  if ($null -eq $match) {
    return $null
  }

  $compiler = $match.Matches[0].Groups[1].Value.Replace('/', '\')
  $marker = '\VC\Tools\'
  $markerIndex = $compiler.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase)
  if ($markerIndex -lt 0) {
    return $null
  }
  return $compiler.Substring(0, $markerIndex)
}

function Find-VisualStudioRoot {
  $cachedRoot = Find-CachedVisualStudioRoot
  if ($cachedRoot) {
    $cachedVcVars = Join-Path $cachedRoot 'VC/Auxiliary/Build/vcvars64.bat'
    if (Test-Path $cachedVcVars) {
      return $cachedRoot
    }
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} `
    'Microsoft Visual Studio/Installer/vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw 'vswhere.exe was not found. Install Visual Studio Build Tools with the C++ workload.'
  }

  $root = & $vswhere -latest -products '*' `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
    throw 'No Visual Studio installation with the x64 C++ build tools was found.'
  }
  return $root.Trim()
}

function Import-VcVars([string]$visualStudioRoot) {
  $vcvars = Join-Path $visualStudioRoot 'VC/Auxiliary/Build/vcvars64.bat'
  if (-not (Test-Path $vcvars)) {
    throw "MSVC environment script not found: $vcvars"
  }

  $arguments = 'call "' + $vcvars + '" >nul && set'
  $environmentLines = & $env:ComSpec /d /s /c $arguments
  if ($LASTEXITCODE -ne 0) {
    throw "vcvars64.bat failed with exit code $LASTEXITCODE"
  }

  foreach ($line in $environmentLines) {
    $separator = $line.IndexOf('=')
    if ($separator -le 0) {
      continue
    }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Find-VcpkgRoot {
  if (Test-Path $cachePath) {
    $toolchain = Select-String -Path $cachePath `
      -Pattern '^CMAKE_TOOLCHAIN_FILE:FILEPATH=(.+)$' |
      Select-Object -First 1
    if ($toolchain) {
      $toolchainPath = $toolchain.Matches[0].Groups[1].Value.Replace('/', '\')
      $suffix = '\scripts\buildsystems\vcpkg.cmake'
      if ($toolchainPath.EndsWith($suffix, [StringComparison]::OrdinalIgnoreCase)) {
        $root = $toolchainPath.Substring(0, $toolchainPath.Length - $suffix.Length)
        if (Test-Path (Join-Path $root 'scripts/buildsystems/vcpkg.cmake')) {
          return $root
        }
      }
    }
  }

  if ($env:VCPKG_ROOT -and
      (Test-Path (Join-Path $env:VCPKG_ROOT 'scripts/buildsystems/vcpkg.cmake'))) {
    return $env:VCPKG_ROOT
  }

  $repoVcpkg = Join-Path $repoRoot '.deps/vcpkg'
  if (Test-Path (Join-Path $repoVcpkg 'scripts/buildsystems/vcpkg.cmake')) {
    return $repoVcpkg
  }

  throw 'vcpkg was not found. Set VCPKG_ROOT or initialize .deps/vcpkg.'
}

function Assert-ToolchainEnvironment {
  $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
  if ($null -eq $cl) {
    throw 'cl.exe is unavailable after loading vcvars64.bat.'
  }

  $includePaths = $env:INCLUDE -split ';' | Where-Object { $_ }
  $libPaths = $env:LIB -split ';' | Where-Object { $_ }
  if (-not ($includePaths | Where-Object { Test-Path (Join-Path $_ 'memory') })) {
    throw 'The MSVC standard-library headers are missing from INCLUDE.'
  }
  if (-not ($includePaths | Where-Object { Test-Path (Join-Path $_ 'Windows.h') })) {
    throw 'The Windows SDK headers are missing from INCLUDE.'
  }
  if (-not ($libPaths | Where-Object { Test-Path (Join-Path $_ 'kernel32.lib') })) {
    throw 'The Windows SDK libraries are missing from LIB.'
  }

  Write-Host "MSVC: $($cl.Source)"
  Write-Host "Windows SDK: $env:WindowsSDKVersion"
  Write-Host "vcpkg: $env:VCPKG_ROOT"
}

function Invoke-Checked([string]$program, [string[]]$arguments) {
  Write-Host "> $program $($arguments -join ' ')"
  & $program @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$program failed with exit code $LASTEXITCODE"
  }
}

$visualStudioRoot = Find-VisualStudioRoot
Import-VcVars $visualStudioRoot
$env:VCPKG_ROOT = Find-VcpkgRoot
Assert-ToolchainEnvironment

Push-Location $repoRoot
try {
  # Reconfigure before cleaning so stale generated build rules cannot make the
  # clean target fail (and so CMake changes are reflected in the rebuild).
  if ($Configure -or $Clean -or -not (Test-Path $cachePath)) {
    Invoke-Checked 'cmake' @('--preset', $Preset)
  }
  if ($Clean) {
    Invoke-Checked 'cmake' @('--build', '--preset', $Preset, '--target', 'clean')
  }
  Invoke-Checked 'cmake' @('--build', '--preset', $Preset)
  if ($Test) {
    Invoke-Checked 'ctest' @('--preset', $Preset)
  }
} finally {
  Pop-Location
}
