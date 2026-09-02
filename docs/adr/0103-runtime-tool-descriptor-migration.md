# ADR-0103: Runtime Tool Descriptor Migration

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 removal of duplicated tool metadata first slice

## Decision

The IDE assistant request now carries the exact `ToolDescriptor[]` compiled
from mounted capabilities, document scope and runtime-discovered tools. The
server validates names against its capability allowlist, filters the supplied
catalog, and uses it for prompt/native-schema generation and response
validation. The legacy server table remains only for explicit direct helper
calls; production `runAssistant` rejects requests that omit descriptors, so
normal clients cannot use that fallback.

This migration preserves server-side security: client descriptors can remove
tools or descriptions but cannot grant a capability absent from the server
allowlist. Plugin and MCP tools still need host implementations and grants.

## Consequences

Frontend and backend no longer need to maintain identical descriptions for
every mounted tool. The remaining static table can be deleted after older
client support is retired and all built-in descriptors are sourced from the
plugin/capability registries.
