# ADR 0050: Runtime message contract validation

## Context

`MessageEnvelope` carries a URI, schema version, encoding, and source method,
but previously the store accepted any non-empty URI. A method could publish a
message with a known URI and the wrong schema, and a checkpoint could restore
that drift without a local failure. Static DSL port checks cannot protect
dynamic plugin messages.

## Decision

`MessageStore` provides an explicit `MessageTypeContract` registry. Once a
contract is registered, `publish` and checkpoint `restore` require an exact
schema version and, when specified, encoding. Conflicting duplicate
registrations are rejected. Unregistered URIs remain accepted for backward
compatibility with legacy/native plugins; methods that own a type are expected
to register it during initialization. The append-only C ABI host service
`register_message_type` exposes the same operation to native plugins and is
guarded by `struct_size`.

## Consequences

Message errors are detected before they enter the event payload arena or a
restored session. The registry is replication-local and is cleared with the
message arena, so contracts cannot leak between runs. Dynamic payload decoders
still own semantic validation of the byte contents; this decision guards the
wire identity and version boundary only.
