# ADR-0083: Agent Engine Registry and Provider-Neutral Steps

Date: 2026-09-02  
Status: Accepted  
Implements: AgentEngine abstraction/spike

## Decision

`AgentEngineRegistry` validates engine descriptors and
`AgentStepRequest/AgentStepResult` at the boundary. The builtin LogicPilot
loop and future OpenAI Agents/Cordis adapters implement the same
`runStep`/`cancel` surface.

The IDE now mounts the current transport through `BuiltinAgentEngine`. The
adapter translates exactly one assistant response, including its plan, tool
calls and usage, into `AgentStepResult`; the surrounding runtime still owns
the multi-step loop, approvals, tool execution and Artifact transactions.

An engine receives only the compiled context and exact tool descriptors for
one step. Tool execution, CapabilityBroker grants, Artifact transactions and
simulation evidence remain outside the engine. An SDK adapter therefore cannot
widen tools or bypass LogicPilot approval.

## Consequences

Provider migration is now an adapter/benchmark decision rather than a rewrite
of the assistant runtime. The registry does not select a provider by itself;
the host chooses an engine descriptor and records it in the step/checkpoint
contracts. SDK-backed engines must pass parity, cancellation, quota and
permission tests before being enabled.
