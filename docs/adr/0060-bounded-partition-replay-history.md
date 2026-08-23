# ADR 0060: Bounded partition replay history

## Context

A replay request identifies a missing sequence range, but a sender that no
longer retains recent frames cannot answer it. The transport must expose that
limitation deterministically instead of claiming recovery.

## Decision

`PartitionReplayHistory<Capacity>` retains the most recent partition events in
a bounded deque. It extracts a requested epoch/source/target sequence range in
ascending order and returns false when any frame in the inclusive range has
fallen out of the window. `RingPartitionTransport` records successfully queued
events when an optional history is attached.

## Consequences

The replay control plane now has a concrete resend source and an explicit
“range unavailable” result. Capacity is a deliberate deployment tradeoff:
larger windows improve recovery distance but consume more memory. Durable
checkpoint replay remains the fallback when a range is no longer retained.
