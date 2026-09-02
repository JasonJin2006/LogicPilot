# ADR-0090: Filesystem Plugin Draft Workspace

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 persistent draft workspace first slice

## Decision

`FileSystemPluginDraftStore` stores each validated `PluginDraft` as an atomic
JSON file under a dedicated draft root. IDs are URI-encoded for path safety;
reads and directory listings validate the complete generated contract before
returning data. Malformed or missing files fail closed with stable store error
codes.

The store is deliberately separate from `FileSystemPackageStore`: writing a
draft never modifies an installed package, lockfile, permissions table or
audit trail. Only a later, explicit publish operation can hand an approved
draft to package installation.

## Consequences

AI drafts survive process restarts and can be reviewed or discarded without
affecting trusted runtime state. Schema/lint/conformance runners and package
builder/signing remain the next boundary before publication.
