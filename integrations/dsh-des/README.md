# LogicPilot DES for DeepSeek Harness

First vertical slice: AI tools edit a session-owned model; native DSH right-sidebar tabs show its flow and metre-scale 3D scene; a deterministic event simulation produces the actual playback and metrics. No DSH source changes.

## Build and install

From the LogicPilot repository (existing workspace dependencies required):

```powershell
node integrations/dsh-des/build.mjs
node --test integrations/dsh-des/test/*.test.mjs
dsh plugin --profile web add "file:C:/Users/JasonJin06/Desktop/LogicPilot/integrations/dsh-des"
```

Restart DSH after installing or rebuilding this file package. The bundle inserts `logicpilot-des`; it contributes the header button and a single **LogicPilot** entry in the right-sidebar guide, with Flow and 3D as internal views of that one tab. Open a DSH session, then click **LogicPilot**. DSH owns docking, splitting, fullscreen and floating panels.

The panel is styled with DSH theme tokens (`--dsw-alias-*`, `--dsw-font-family`), so it follows the active light/dark theme; the Three.js viewport reads the same tokens for its clear colour, floor, grid and labels.

The package targets DSH `0.1.6-alpha.2`; framework packages are peers supplied by the host, not nested runtime dependencies. The client privately bundles Three.js using LogicPilot's installed version; React is supplied by DSH.

## AI workflow

1. `logicpilot_get_model`: read model/revision, complete example and supported contract.
2. `logicpilot_set_model`: submit the entire edited model with `baseRevision`. IDs link semantic nodes, parameters and 3D objects.
3. `logicpilot_simulate`: calculate a seeded experiment and persist its actual entity event trace.

Example prompt: “用 LogicPilot 建一条装配检验线：来料平均每 18 秒一件，两台装配设备每件平均处理 26 秒，再经过 12 秒检验，仿真 80 件。按 28×16 米场地布置占位设备，并说明尺寸假设。”

## Current semantics

- One connected acyclic chain with source, optional FIFO queue before each service, service/delay nodes, and sink; 3–32 nodes, 1–500 entities.
- Infinite FIFO queues; each service has independent capacity 1–16. Constant or exponential time distributions. First arrival occurs after the first sampled interarrival. Run drains all admitted entities.
- Transport uses each edge's explicit `travelSeconds`; it is not inferred from the 3D distance. Queue-to-service zero transport allows waiting entities to be drawn in the queue footprint.
- Utilization = total busy time / (experiment duration × capacity), including startup and final drain. No warm-up subtraction, statistical confidence intervals, branching, shared pools, failures or collision/path planning.
- Engine is **Visual DES 0.1**, a small JavaScript discrete-event engine, **not** LogicPilot's C++ kernel. Do not compare it as a native trace. Native execution is a later adapter, not a claimed capability.
- Coordinates are metres: X/Z floor plane, Y base height; dimensions are width/height/depth; rotation is yaw in degrees. Bounds are enforced; conservative rotated AABB overlap is a warning. Scene geometry is schematic; estimated dimensions need user validation.
- `assetRef` reserves a stable asset identifier. This version renders parametric placeholders only; GLB import and asset replacement UI are not implemented.

## Persistence and lifecycle

Models and results are saved atomically under `$DSH_HOME/logicpilot-des/<sha256(session-id)>.json`. Model writes invalidate old results; revision checks reject concurrent edits with HTTP 409. Serialization is within one DSH process; do not run two DSH processes writing the same data home. Results reload after a restart. Browser polling uses revisions and stops on disposal. Three.js resources/listeners/observers are disposed when a view closes.

The model endpoint uses DSH's authenticated Connection exact Fetch-route mechanism. Data belongs to the local authenticated DSH user; this is not a multi-user authorization layer. AI tools use their calling agent's ID as the session artifact key. No model API keys are read by the plugin.

## Validation

Tests establish hand-computed FIFO and parallel-server schedules, deterministic replay, entity conservation, graph/spatial rejection, optimistic concurrency, restart persistence, and invalidation. Test the installed DSH page as well: create a session, load the example, run, open 3D, split the panel, edit a dimension, check simulation invalidation, and reload.
