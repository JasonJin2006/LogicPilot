# ADR-0089: Structured AI Plugin Draft Approval

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 draft pipeline first slice

## Decision

AI-created plugin changes are represented by a `PluginDraft` contract and a
host-owned `PluginDraftRegistry`. A draft contains a validated manifest and
structured contribution set, records its base plugin, and computes added and
removed permissions plus trust-level escalation.

The only legal lifecycle is:

```text
draft -> validated -> approved -> published
```

Validation rejects contribution ownership/version mismatches. Approval
requires the user to enumerate every newly requested permission and explicitly
accept any trust escalation. Publishing is impossible before approval; the
registry never mutates an installed plugin or lockfile by itself.

## Consequences

Knowledge, skill, instruction, diagnostic, view and notation changes can now
be reviewed as structured plugin diffs rather than natural-language patches.
`FileSystemPluginDraftStore` persists those drafts atomically in a workspace;
the next slice runs schema/lint/conformance checks, then hands an approved
draft to the existing content-addressed package manager for signing and
installation.
