# ADR-0104: Hermetic Staged Agent SDK Bundle

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 desktop runtime packaging

## Decision

The optional OpenAI Agents adapter is bundled as a self-contained Node ESM
artifact by `@logicpilot/agent-openai`. Desktop staging copies that bundle and
the agent endpoint script; the staged app server does not resolve SDK,
contracts or workspace `node_modules` at startup. The endpoint dynamically
loads the bundle only when `LOGICPILOT_AGENT_ENGINE=sdk.openai-agents`.

## Consequences

Builtin desktop startup remains independent of the SDK, while an explicitly
configured SDK deployment has a hermetic runtime. The bundle is larger because
it includes the SDK/provider dependencies; future staging can split or cache
it without changing the AgentEngine contract.
