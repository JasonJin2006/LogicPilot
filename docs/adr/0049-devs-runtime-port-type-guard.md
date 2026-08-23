# ADR 0049: DEVS runtime port type guard

## Context

LP5009 rejects incompatible typed couplings in the DSL compiler, but a native
DEVS model or hand-built IR can bypass that path. Loading such a model would
silently deliver a payload to a port with a different declared message type.
That is a correctness failure, especially when models are composed from
versioned method plugins.

## Decision

`AtomicModel` stores an optional event type alongside each declared port.
`IrAtomicModelV2` copies `ir_v2.Port.event_type` into that metadata. During
`DevsRuntimePlan::compile`, after nested parent-port pass-through is flattened,
each atom-output route is checked against every final atom-input sink:

- non-empty ordinary types must match exactly;
- empty types preserve compatibility for legacy atoms;
- `any` and `message` are explicit wildcard contracts.

An incompatible route throws a deterministic `std::logic_error` containing both
atom paths and types. The executor therefore refuses to load the model rather
than running with an invalid message contract.

## Consequences

The compiler and runtime now enforce the same two-layer contract. Existing
untyped C++ atoms remain source-compatible, while typed IR and plugins receive
an early, actionable failure. Dynamic payload schema/version validation remains
the responsibility of the method that decodes a `MessageEnvelope`.
