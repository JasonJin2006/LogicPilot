# ADR-0108: Resumable Agent Turns and Provider-Neutral Trace Boundary

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 Agent Runtime Productionization (first slice)

## Decision

`AgentStepRequest` may carry an `AgentCheckpoint` and host-produced
`toolResults`. An engine must reject tool results without a checkpoint, verify
that every result matches a pending call in the checkpoint, apply approval or
rejection in the SDK run state, and then resume the run. The engine remains
unable to execute LogicPilot tools directly.

The OpenAI Agents adapter serializes the SDK `RunState` into the checkpoint on
an approval interruption and resumes it with `RunState.fromString`. Approved
host results are returned to the SDK tool boundary only for the matching call;
rejected results are represented as SDK approval rejection messages. The
checkpoint state is serialized without tracing API keys. The app-server exposes
an explicit `LOGICPILOT_AGENT_TRACE_ROOT` opt-in that appends these
metadata-only events as JSONL; deployments can ship that file to their own
trace backend.

`AgentEngineRegistry` and the SDK adapter expose an optional metadata-only
`AgentEngineTraceSink`. The default events contain turn/step identity,
timestamps, latency, status and tool names, but not prompts, tool arguments,
model output or secrets. Sensitive tracing requires an explicit separately
governed recorder.

## Consequences

The host can perform arbitrary permission, capability and Artifact transaction
work between model rounds without rebuilding a conversation from lossy text.
The checkpoint is transportable across the HTTP endpoint and can later be
persisted in an Artifact or durable session store. Trace consumers can record
production diagnostics without accidentally storing model prompts or tool
payloads.

The remaining Phase 8 gate is a real-provider parity/evaluation run and an
operationally managed trace retention/export policy; this ADR does not
authorize switching the default engine.
