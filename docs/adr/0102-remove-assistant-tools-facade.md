# ADR-0102: Remove the Legacy Assistant Tools Facade

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6/8 compatibility cleanup

## Decision

Remove `src/ai/assistantTools.ts`, the duplicate compatibility export for the
LogicPilot capability registry. Tests and runtime consumers import the
capability-owned registry directly. There is no public package API that needs
the old path.

## Consequences

The IDE has one authoritative tool lookup path and no stale facade that can
drift from capability scoping or plugin authoring/view tools. Larger legacy
static tables in the server assistant remain until their provider-neutral
replacement has parity coverage.
