# ADR-0100: AgentEngine Contract Parity Harness

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 engine replacement gate

## Decision

`benchmarkAgentEngines` runs the same validated `AgentStepRequest` fixtures
through a primary and candidate engine. It compares provider-neutral status,
message, plan, tool calls, tool results and error fields, and records per-side
latency. The harness never executes a returned tool call; host approval,
capability checks, Artifact transactions and evidence remain outside it.

The candidate request is rebound to the candidate engine id before dispatch.
An engine may replace the default only after its parity report passes together
with cancellation, quota, approval and real-provider evaluation gates.

## Consequences

Builtin, OpenAI Agents and future Cordis implementations can be compared with
the same deterministic contract tests. Differences become explicit data for a
migration decision instead of hidden behavior changes inside the assistant
loop.

The OpenAI adapter package now runs a real SDK `ScriptedModel` fixture through
this harness; the tool-interruption case is green without network credentials.
