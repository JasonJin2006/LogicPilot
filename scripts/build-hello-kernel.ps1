$ErrorActionPreference = 'Continue'
# MinGW runtime DLLs must be discoverable for cc1plus.exe (lives in lib/gcc/<ver>/).
$env:PATH = 'C:\msys64\ucrt64\bin;' + $env:PATH
$cmake = 'C:\Program Files\CMake\bin\cmake.exe'
$root = 'c:\Users\JasonJin06\Desktop\LogicPilot'
$ninja = 'C:\Users\JasonJin06\AppData\Local\Microsoft\WinGet\Packages\Ninja-build.Ninja_Microsoft.Winget.Source_8wekyb3d8bbwe\ninja.exe'

Remove-Item "$root\build\local-gcc" -Recurse -Force -ErrorAction SilentlyContinue

& $cmake -S $root -B "$root\build\local-gcc" -G Ninja `
  -DCMAKE_C_COMPILER=C:/msys64/ucrt64/bin/gcc.exe `
  -DCMAKE_CXX_COMPILER=C:/msys64/ucrt64/bin/g++.exe `
  "-DCMAKE_MAKE_PROGRAM=$ninja" `
  -DCMAKE_BUILD_TYPE=Release
Write-Host ("configure exit: " + $LASTEXITCODE)

if ($LASTEXITCODE -eq 0) {
  & $cmake --build "$root\build\local-gcc"
  Write-Host ("build exit: " + $LASTEXITCODE)
  if ($LASTEXITCODE -eq 0) {
    Write-Host '--- run hello_kernel ---'
    & "$root\build\local-gcc\kernel\hello_kernel.exe"
    Write-Host ("run exit: " + $LASTEXITCODE)
  }
}
