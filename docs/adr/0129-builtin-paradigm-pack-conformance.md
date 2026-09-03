# ADR-0129: Built-in Paradigm Pack Conformance Gate

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 migration acceptance

## Decision

Every builtin paradigm pack must pass one shared conformance suite. The suite
validates its PluginManifest and PluginContributionSet, requires non-empty
knowledge, skills, instructions and diagnostics, checks that the declared
paradigm scope is present, and verifies its declared Canvas mapping. A special
assertion guarantees SysML and C4 share `graph2d` while retaining distinct
NotationPack owners and rules.

The gate runs in the IDE package test suite, so adding a new data-only pack
without structured domain resources fails CI immediately.

## Consequences

Agent, Continuous, DEVS, Statechart, Process and SysML packs now have the same
minimum quality bar. C4 can share the generic Graph2D engine without being
mistaken for SysML because notation identity and owner remain separate.
