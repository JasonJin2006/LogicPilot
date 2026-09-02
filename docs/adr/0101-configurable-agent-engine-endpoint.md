# ADR-0101: Configurable AgentEngine Runtime Endpoint

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 runtime engine selection

## Decision

`/api/config` exposes the normalized `agentEngine` selection. The default is
`builtin`; setting `LOGICPILOT_AGENT_ENGINE=sdk.openai-agents` enables
`POST /api/agent-step`, which validates the frozen `AgentStepRequest`, invokes
the real optional OpenAI Agents adapter and validates the resulting
`AgentStepResult`. The IDE chooses the endpoint only when the config selects
that engine; all other turns retain the existing Builtin transport.

The endpoint receives exact compiled tool descriptors and never executes tool
calls. Approval, capability grants, Artifact transactions and evidence remain
owned by the outer IDE/host loop. Invalid or disabled engine requests fail
closed with stable HTTP errors.

## Consequences

Engine migration is now a deployment/configuration choice with a common wire
contract and parity harness. A deployment must provide the SDK's provider
credentials and pass the parity/cancellation/quota gates before enabling it;
the browser bundle does not import the SDK package.
