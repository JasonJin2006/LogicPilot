# Runtime package sources

Each family directory contains its manifest. `entrypoint.mjs` is the only runtime entrypoint
source. `scripts/build-runtime-plugins.mjs` copies that template as `runtime.mjs` into each output
package and computes the package digest. Outputs are independent package directories, not symlinks.

Run `pnpm desktop:stage` after building the release sidecars. The resulting packages and lockfile
are under `build/desktop-runtime/plugins/runtime` and `build/desktop-runtime/plugin-store`.
Do not point a Node catalog at these source directories: their entrypoints are build outputs.
Do not add copies of the entrypoint back to source or manually maintain digest strings.

The builder intentionally supports only the approved system families (the four
single-method runtimes plus the generic mixed-method target) and
`runtime.service.call`. Changing that authority requires an explicit release-policy change.
Kernel execution is currently a host service; see `docs/architecture/current-state.md` for limitations.
