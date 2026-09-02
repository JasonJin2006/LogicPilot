# ADR-0081: IDE Consumption of Generation-Aware Plugin Contributions

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 2C registry bridge

## Decision

The IDE fetches `PluginRegistry` from `/api/plugin-registry` using the same
session headers as catalog discovery. `PluginRegistryStore` validates the
generated envelope before replacing its snapshot and rejects stale generations
or contributions belonging to unknown plugins.

Trusted knowledge is selected by the assistant context builder. Structured
palette metadata is exposed to the generic Palette panel as library/item
entries; semantic insertion remains owned by the plugin's canvas/notation
contribution and is not inferred by the Shell.

## Consequences

Browser code never scans package directories or imports Node modules. A
generation update replaces the complete contribution snapshot, so removed
plugins cannot leave stale metadata in the next assistant turn or palette
render. The bridge remains read-only; install/upgrade continues to require the
Node PackageManager transaction path.
