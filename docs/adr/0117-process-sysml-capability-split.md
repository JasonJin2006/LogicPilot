# ADR-0117: Split Process and SysML Agent Capabilities

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 built-in paradigm migration (capability slice)

## Decision

The IDE registers `logicpilot-process` and `logicpilot-sysml` as separate
capabilities, with independent read-only variants. Process/DSL tools are
available only outside a SysML document scope; SysML tools are available only
inside a SysML scope. A modeling profile may compose both capabilities, but no
runtime capability named `logicpilot-modeling` remains.

The old `logicpilot-modeling` capability index and combined tool registry are
deleted. Tool implementation modules may remain physically grouped during the
ongoing migration, but their registration boundary is now paradigm-specific.

## Consequences

Unregistering the Process or SysML capability removes its tools from Agent
descriptor compilation without changing the other paradigm. Profiles and
server-side capability metadata use the same split ids, so scope filtering is
consistent across the IDE and assistant endpoint.
