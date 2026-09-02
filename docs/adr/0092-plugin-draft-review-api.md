# ADR-0092: App-Server Plugin Draft Review API

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 draft review bridge first slice

## Decision

The local app-server exposes `GET/POST /api/plugin-drafts` for the persisted
draft workspace. The API supports create, validate, approve, reject and
publish transitions and returns validated draft entities plus static
validation reports. A create request must start in `draft`; approval must list
all added permissions and explicitly acknowledge trust escalation.

The route is session/origin gated like other local APIs, bounds request bodies,
returns stable errors without filesystem paths, and never invokes an entrypoint
or changes the installed package lockfile. `published` is a review state, not
an implicit install; package building/signing and `PackageManager` handoff are
separate operations.

## Consequences

The IDE `Plugin Drafts` panel can safely inspect and approve AI-generated
knowledge, skill, instruction, diagnostic, view and notation changes across
process restarts. Runtime activation remains unchanged until an explicit
package publication pipeline is implemented.
