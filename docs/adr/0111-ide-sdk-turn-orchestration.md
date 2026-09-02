# ADR-0111: IDE SDK Turn Orchestration

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 Agent Runtime Productionization (IDE integration)

## Decision

The IDE keeps one stable `turnId` and increments `stepIndex` for an SDK-backed
assistant turn. After the provider returns an approval checkpoint, the IDE
executes the approved LogicPilot tools locally, converts their results to the
AgentEngine `ToolResult` contract, and sends the checkpoint plus results to the
next `/api/agent-step` request. The provider must return a checkpoint for every
non-terminal SDK response; otherwise the turn fails closed.

The existing assistant kernel remains the source of user-visible transcript,
approval UI, Artifact transactions and undo semantics. The SDK checkpoint is a
separate provider continuation field and is never reconstructed from rendered
natural-language messages.

## Consequences

The desktop SDK path now exercises the same approval boundary as the direct
Node adapter and cannot silently fall back to stateless repeated prompts.
Builtin turns retain their existing transport and do not require SDK state.
