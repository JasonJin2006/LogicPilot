# ADR-0094: SDK AgentEngine Adapter Boundary

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 external Agent SDK spike

## Decision

`SdkAgentEngineAdapter` is the provider-neutral boundary for an external agent
runner such as OpenAI Agents. The injected runner receives only the validated
step input, compiled context and exact `ToolDescriptor[]` for that step. Its
output is normalized to `AgentStepResult`, including plan, tool calls, status,
usage and errors.

Before returning to the host, every SDK tool call is checked against the exact
compiled tool-name set. A call outside that set fails closed; the SDK cannot
widen capabilities or bypass LogicPilot approvals, transactions or evidence.
The current `BuiltinAgentEngine` remains the default. The optional
`@logicpilot/agent-openai` package now implements the boundary with
`@openai/agents@0.17.0`; it is not imported by the browser or core plugin host.
The package is built and tested independently; selecting it in a deployment
still requires explicit host configuration and parity approval.

## Consequences

OpenAI Agents/Cordis can be benchmarked and enabled by injection rather than a
core rewrite. The parity gate must compare tool ordering, plan preservation,
cancellation, quotas, approval behavior, context generation and error
semantics before changing the default engine. Installing the external SDK is a
separate deployment decision.
