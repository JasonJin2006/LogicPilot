# LogicPilot Workspace

LogicPilot follows the VS Code workspace model. A workspace owns one or more
folder roots; a `logicpilot.json` project bundle is an optional model artifact
inside one of those roots.

## States

- **No workspace**: the canvas is scratch-only and mutating AI tools are not mounted.
- **Folder workspace**: a plain folder is writable even before it contains a
  `logicpilot.json`; the first Save initializes the project bundle.
- **Project workspace**: an existing bundle is the active model and dirty
  changes are saved through the normal conflict-checked path.

## File format

`.lpworkspace` files are JSON with schema `logicpilot.workspace`, version `1`,
a display name, and a list of `{ path, name }` folder roots. They contain no
API keys, model source, or run output.

The workspace root is the security boundary for host-mounted capabilities:
skills are discovered below workspace roots, and model/file mutations are
rejected when no workspace is open.

