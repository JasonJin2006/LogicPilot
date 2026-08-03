# ADR-0001: C++20 on MSVC without C++20 Modules

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

LogicPilot's kernel targets C++20 on both MSVC (Windows, primary dev platform)
and clang (Linux, CI/release). C++20 Modules offer faster compiles and better
encapsulation, but:

- MSVC's module support, while functional, still has rough edges in tooling
  (CMake module dependency scanning maturity, IntelliSense, clang-tidy
  integration).
- vcpkg-provided dependencies (EnTT, Boost.Beast, fmt, spdlog, Catch2) ship
  predominantly as headers/static libs without module interface units, so
  modules would mostly wrap third-party code with shims.
- CI needs deterministic, boring builds across two toolchains.

## Decision

Use **C++20 with classic headers/TUs** as the compilation model. **Do not use
C++20 Modules** for the kernel in Phase 0–5. Leverage C++20 language features
(concepts, ranges, coroutines where useful) via headers only.

## Consequences

- Positive: maximum toolchain compatibility (MSVC + clang), full clang-tidy /
  clang-format / vcpkg support, simple CMake.
- Negative: slower full builds than a mature modules setup; header include
  hygiene becomes a discipline (enforced via include ordering rules).
- Revisit: when CMake ≥3.30 module support and MSVC/clang tooling mature, open
  a superseding ADR.

## Phase 0 Environment Blocker (recorded 2026-08-03)

The Phase 0 dev machine (Windows) has **Visual Studio 2026 Community (v18.7.3)
installed WITHOUT the C++ workload**: no `cl.exe`, no MSVC STL, no
`vcvarsall.bat`. Installing the workload requires the VS Installer with
elevated/admin rights, which is out of scope for the sandboxed Phase 0
session. CMake 4.4.1, Ninja 1.13.2 and a bootstrapped vcpkg were installed
successfully (winget); `kernel/src/hello_kernel.cpp` and all CMake targets are
in place and build-ready — the first full MSVC build becomes the acceptance
check of the next task once the C++ workload is installed:

```bat
:: one-time: in a VS 2026 installer session, add workload
::   "Desktop development with C++" (Microsoft.VisualStudio.Workload.NativeDesktop)
set VCPKG_ROOT=<repo>\.deps\vcpkg
cmake --preset windows-msvc-dev
cmake --build --preset windows-msvc-dev
```

**Toolchain validation anyway**: with LLVM 22.1.8 installed but the MSVC STL
still absent (clang on Windows needs it), the toolchain was validated using
MinGW-w64 GCC 16.1.0 (MSYS2 ucrt64) as a stopgap compiler —
`scripts/build-hello-kernel.ps1` configures + builds + runs `hello_kernel`
successfully (`LogicPilot kernel online.`, exit 0). LLVM 22.1.8 becomes usable
for the `windows-msvc` family targets as soon as the MSVC STL ships with the
C++ workload.

