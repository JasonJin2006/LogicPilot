# Repository build guidance

- On Windows, ordinary PowerShell sessions do not contain the temporary MSVC
  and Windows SDK environment created by `vcvars64.bat`. Do not invoke an MSVC
  CMake build directly from such a session.
- Use `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test` (or the
  `windows-msvc-release` preset). The script discovers the Visual Studio
  instance that matches an existing CMake cache, imports its x64 environment,
  locates vcpkg, validates the standard-library/SDK paths, then configures,
  builds, and optionally tests.
- Existing build trees skip configure by default, avoiding an unnecessary
  vcpkg manifest pass. Use `-Configure` after changing CMake files or presets;
  a missing build tree is configured automatically. The script always loads
  and validates the complete toolchain.
