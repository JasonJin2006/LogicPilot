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
- Use `-Clean` for a reproducible clean rebuild. It refreshes the CMake rules
  before cleaning, preserves dependency caches, and then performs the normal
  build; combine it with `-Test` for the full local gate.
