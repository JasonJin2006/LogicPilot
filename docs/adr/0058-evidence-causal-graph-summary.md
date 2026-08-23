# ADR 0058: Evidence-derived causal graph summary

## Context

DEVS evidence records identify the source atom for each input, but consumers
that need causal topology had to repeatedly reconstruct edges from raw vectors.
That encourages order-dependent or UI-specific inference and wastes the stable
causal information already captured by PDEVS bags.

## Decision

`DevsEvidenceGraph::build` aggregates evidence into deterministic atom-to-atom
edges. Each edge carries source/target IDs and paths, input message count, and
the number of distinct transitions that delivered those inputs. Edges are
ordered by `(source, target)` and expose an FNV-1a hash over the complete
summary. Input/source cardinality violations are rejected.

## Consequences

Offline analysis and AI explanation can consume a compact causal topology with
measured counts rather than guessing from names or a single run's event text.
The graph is observational evidence, not a proof of intervention causality;
experiment-level comparison remains a separate statistical layer.
