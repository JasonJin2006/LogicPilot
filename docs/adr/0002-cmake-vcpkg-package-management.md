# ADR-0002: CMake + vcpkg Manifest Mode as the Sole C++ Package Manager

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

The C++ ecosystem has multiple dependency strategies (system packages,
FetchContent/CPM submodules, Conan, vcpkg, manual vendoring). LogicPilot needs
reproducible builds on Windows (MSVC) and Linux (clang), in CI and locally.

## Decision

- **CMake ≥ 3.25** is the only build system for C++.
- **vcpkg in manifest mode** (`vcpkg.json` at repo root) is the only mechanism
  for acquiring third-party C++ dependencies.
- Version pinning is done via the **`builtin-baseline`** field in `vcpkg.json`,
  pinning the whole ports tree to a single vcpkg commit; per-port
  `version>=` overrides are allowed only with justification.
- **Baseline hygiene rule**: when updating the baseline, it must be pinned to an
  official vcpkg release tag / commit (never a moving `HEAD`), and the change
  is recorded in the commit message. CI caches `vcpkg_installed/` keyed by
  `vcpkg.json` + baseline hash.
- Bootstrap on machines without vcpkg: clone `microsoft/vcpkg` into `.deps/`
  (gitignored) and point `VCPKG_ROOT` at it; CI uses the pre-installed runner
  vcpkg.

## Consequences

- Positive: single source of truth for versions; identical behavior locally and
  in CI; no Conan server required.
- Negative: initial dependency build time (mitigated by CI caching); baseline
  must be maintained deliberately.
