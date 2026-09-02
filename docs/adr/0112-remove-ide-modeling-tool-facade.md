# ADR-0112: Remove IDE Modeling Tool Compatibility Facade

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6/8 compatibility cleanup

## Decision

The IDE no longer exports `ASSISTANT_TOOLS` or `findAssistantTool` from a
compatibility module. Runtime code imports the capability-owned
`LOGICPILOT_MODELING_TOOLS` and `findLogicPilotTool` registry directly; the
generic `AssistantTool` type comes from the neutral IDE tool contract.

The production shell therefore has one modeling registry and one naming
scheme. Test-only fixtures may retain descriptive historical names when they
are deliberately constructing a static fixture and are never imported by the
runtime.

## Consequences

Future capability migration cannot silently add another alias layer. A tool
must be registered through its capability/plugin contribution and exposed via
the neutral AgentEngine descriptor path.
