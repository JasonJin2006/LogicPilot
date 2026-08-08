# AI ModelPatch protocol

`ModelPatch` is the stable boundary between an AI modeler and the LogicPilot
canvas. AI output must describe model operations; it must not mutate Zustand
state or replace project files directly.

```json
{
  "version": 1,
  "operations": [
    { "op": "add_block", "kind": "queue", "name": "Waiting", "params": { "capacity": 50 } },
    { "op": "update_block", "target": "Arrival", "params": { "arrival": "rate(2)" } },
    { "op": "connect", "from": "Arrival", "to": "Waiting" }
  ]
}
```

Version 1 operations:

- `rename_model`
- `add_block`
- `update_block`
- `remove_block`
- `connect`
- `disconnect`

Targets may be node IDs or unique block names. IDs are preferred for edits to
an existing canvas; names make newly generated multi-operation patches easy to
read and test.

## Transaction semantics

Application is atomic. Every operation is evaluated against a temporary
document. An invalid target, duplicate block, duplicate connection, or invalid
operation returns an `MPxxxx` diagnostic and the original document unchanged.
A successful patch becomes exactly one IDE undo step.

## AI workflow

1. `inspect-model`: send the current document, including stable node/edge IDs.
2. `propose-model-patch`: produce a versioned, schema-checked `ModelPatch`.
3. Apply the patch to a temporary document and generate candidate DSL.
4. `validate-model`: compile the candidate and show property/block diagnostics.
5. Preview the exact operations and flag removals/disconnections.
6. Apply atomically only if the inspected document is still current.
7. `run-model`: regenerate DSL from the accepted canvas, run it, and consume
   structured `metrics.json`, especially `blocks`.
8. `query-metrics`: answer result questions from that completed run without
   regenerating or silently rerunning a different model.
9. `compare-metrics`: for an existing model, retain the baseline run and
   compare it with the accepted-patch run under identical seed/run settings.

Existing canvases use the structured patch provider directly. The offline
provider supports common DES parameter, add/remove/connect, and rename
operations; the configured LLM provider is constrained through the same
function-tool schema. Full-model generation is used to bootstrap an empty
canvas and is converted to a semantic diff before it can touch editor state.
Matching block and edge IDs and existing canvas positions are preserved. If
several blocks of one kind exist, the offline provider requires the user to
name the target instead of guessing.

Comparisons match blocks by semantic `kind:name`, explicitly report added and
removed blocks, and expose before/after/delta values for departures, mean
occupancy, utilization, timeouts, and preemptions. They do not infer causality
beyond the two measured runs.

## Conversation history

Only accepted patches enter assistant history. Each persisted turn records the
user request, exact ModelPatch, tool outcome, and grounded run/comparison
summary. Histories are scoped by project path (or model name when no project
exists), bounded to 20 turns and 20 scopes, and can be cleared in the panel.
The patch provider receives at most the most recent 20 turns. This allows
follow-ups such as “make it 4 instead” to resolve the last real target without
granting the assistant direct access to editor state.

The deterministic provider currently recognizes common DES parameter changes,
parameterized Source/Queue/Service/Resource additions, block removal,
connect/disconnect, and model rename. Adding a Service resolves its named or
sole ResourcePool and includes that reference in the Patch. All candidates
still pass the normal temporary-document and compiler validation gates.
