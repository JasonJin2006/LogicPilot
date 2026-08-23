# ADR 0061: First-divergence evidence diagnostics

## Context

Evidence hashes are compact and fast, but a mismatch only says that two runs
differ. Parallel barrier and checkpoint replay debugging needs the first causal
field that diverged, not a manual dump of two large traces.

## Decision

`DevsEvidenceComparator::first_difference` compares two evidence sequences in
stable record order and reports the first differing record index, field path,
expected value, and actual value. It checks transition scalars, atom paths,
input/output port payloads, and source cardinality. A record-count mismatch is
reported separately.

## Consequences

Determinism failures become actionable diagnostics while the existing hash and
archive formats remain unchanged. The comparator is intentionally observational
and linear in trace size; it is a cold-path debugging tool, not a hot-loop
instrumentation requirement.
