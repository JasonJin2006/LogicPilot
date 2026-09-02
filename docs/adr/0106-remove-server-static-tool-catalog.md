# ADR-0106: Remove the Server Static Tool Catalog

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 tool registry cleanup

## Decision

Delete the server-side `ASSISTANT_TOOLS` metadata array. Production
`runAssistant` already requires the runtime `ToolDescriptor[]` compiled by the
IDE capability host; prompt generation, native schema construction and
response validation all consume that payload. A small descriptor fixture lives
under `scripts/` only for protocol unit tests and is never imported by the
assistant runtime.

The server still enforces the independent capability allowlist from
`agent-profiles.mjs`, so runtime descriptors cannot grant tools or permissions.

## Consequences

Tool descriptions and parameter metadata have one live source at the mounted
capability/plugin host. Adding a tool no longer requires editing a second
server table. Older clients that omit descriptors fail fast and must migrate;
this is intentional because implicit fallback could reintroduce stale or
over-broad tool exposure.
