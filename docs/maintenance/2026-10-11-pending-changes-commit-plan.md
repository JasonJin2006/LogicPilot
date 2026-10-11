# 待提交改动分批方案（2026-10-11）

> 对象：工作区内 **164 个已修改 + 130 个未跟踪** 文件（`git diff --shortstat` = +8231 / −1427）。
> 本文只给**计划**，未执行任何 `git add/commit/push`。执行前请逐批确认。
> 背景：本地 `main` 已领先 `origin/main` **278 个提交**（全部未推送）；最后一次提交 `debbac2`（2026-09-03）。

## 这次改动在讲一个什么故事

一条以 **ADR-0134 / 0135 / 0136** 为骨架的主线：

1. **ADR-0134（09-03）** 正式运行时插件包 —— 把执行能力固化成可分发、可校验的 runtime 包（catalog + lockfile + Worker + digest）。
2. **ADR-0135（09-04）** 维护、证据与契约边界 —— 内核边界门禁、WIT 契约校验、证据语义收口。
3. **ADR-0136（09-05）** 统一执行会话协议 —— 执行会话 / Gateway 收口（`execution-session-gateway-plan.md`，G0~G9，**尚未实施**）。

外加两条支线：**3D 场景（scene3d 新包）** 与 **IDE 插件/范式生命周期重构**。DSH 集成原型（`integrations/dsh-des`）是第三条新支线，属原型参考。

## 建议的提交批次（按依赖顺序）

> 原则：契约先行 → 消费者在后；每批独立可验证；避免 `git add -A`，按路径精确暂存。

### B0 · 仓库卫生（先做，独立提交）
- `.gitignore` 增加 `.zcode/`（ZCode 会话计划属本地工具产物）。
- 处置 `integrations/dsh-des/` 与 `.zcode/plans/`：前者若保留则随 B12 入库，后者不入库。
- 涉及：`.gitignore`（改）、`.zcode/plans/*.md`（不入库）
- 建议 message：`chore: ignore local zcode plan cache`
- 验证：`git status` 中 `.zcode/` 消失。

### B1 · 契约演进（必须最先落地）
- 新增 `schemas/contracts/execution-session.schema.json`、`plugin-services.schema.json`（含 `baseline/` 同名）。
- 修改 `execution-target` / `plugin-contributions` / `plugin-manifest-v2`（含 `baseline/`）。
- `schemas/wasm/logicpilot-plugin.wit`。
- 生成物：`kernel/include/logicpilot/contracts/contracts_generated.h`、`kernel/src/contracts/contracts_generated.cpp`、`web/packages/contracts/src/generated/{contracts,registry,schemas}.ts`、`web/packages/contracts/test/contracts.test.ts`。
- ⚠️ 生成物**只用** `node scripts/gen-contracts.mjs` 更新，不手改。
- 建议 message：`feat(contracts): add execution-session and plugin-services schemas`
- 验证：`node scripts/check-contract-conform.mjs` ✅（已实测通过：18 schemas / 124 defs）

### B2 · 插件宿主与执行目标
- `web/packages/plugin-host/src/`：`capability-broker.ts`、`execution-target-registry.ts`、`host.ts`、`index.ts`（改），`execution-service.ts`（新）。
- 测试：`capability-broker.test.ts`、`execution-target-registry.test.ts`（改），`execution-service.test.ts`（新）。
- 建议 message：`feat(plugin-host): add execution service over target registry`

### B3 · Node 运行时与正式 runtime 包
- `web/packages/plugin-catalog/src/`：`dynamic-loader.ts`、`node-runtime.ts`、`node-shims.d.ts`、`wasm-bindings.ts`、`index.ts`（改），`component-runner.ts`、`execution-run-store.ts`（新）+ 对应测试。
- `plugins/runtime/`：`entrypoint.mjs` + 5 个 `plugin.json` + `README.md`（新）。
- 建议 message：`feat(plugin-catalog): load formal runtime packages`
- 验证：`node scripts/test-node-runtime-e2e.mjs`（需先 build plugin-catalog）。

### B4 · 执行边界与子进程监督
- `scripts/`：`subprocess-supervisor.mjs`、`runtime-adapters.mjs`、`runtime-conformance.mjs`、`kernel-boundary.mjs`、`check-kernel-boundary.mjs`、`check-wit-contract.mjs`（新）。
- 测试脚本：`test-execution-boundary`、`test-kernel-boundary`、`test-kernel-supervisor`、`test-plugin-lifecycle`、`test-runtime-adapters`、`test-runtime-conformance`、`test-session-host`（新）。
- `app/execution-websocket.mjs`（新）、`app/server.mjs`、`app/request-policy.mjs`（改）。
- `package.json`（新增门禁脚本 + `lint:ci` 收紧到 `--max-warnings=0`）。
- 建议 message：`feat(runtime): add subprocess supervisor and boundary gates`
- 验证：本方案已实测 6 个门禁全绿（见文末）。

### B5 · 会话宿主与组件运行器（C++ / Rust）
- `kernel/apps/lp-session-host/main.cpp`（新）、`kernel/apps/lp-server/server.cpp`、`kernel/apps/lpcli/compile_command.cpp`（改）。
- `CMakeLists.txt`、`kernel/CMakeLists.txt`、`cmake/msvc-output.mjs`（改/新）。
- `runtime/component-runner/`（Cargo.toml/Cargo.lock/src/fixtures，新）
- `scripts/build-runtime-plugins.mjs`、`build-component-runner.mjs`、`stage-desktop-runtime.mjs`（新/改）。
- 建议 message：`feat(kernel): add session host and component runner build`
- 验证：`./scripts/windows-build.ps1 -Preset windows-msvc-dev -Configure -Test`（Windows 专用纪律）。

### B6 · 内核方法层（复制/目标族）
- `kernel/include/logicpilot/runtime/{replication.h,simulation_method.h,simulation_session.h}`、`kernel/src/runtime/simulation_session.cpp`、`kernel/include/logicpilot/devs/ir_atomic.h`。
- `methods/`：`agent`、`process`、`sd`、`statechart`（含新 `*_network.*`、`*_replication.*`）。
- `kernel/tests/test_lp_server_integration.cpp`、`test_simulation_kernel.cpp`。
- 建议 message：`feat(kernel): replication and simulation session targets`

### B7 · DSL 编译器
- `dsl/compiler/`（`registry.h`、`semantic.h`、`compile.cpp`、`lowering.cpp`、`registry.cpp`、`semantic.cpp` + 测试）。
- 新增 `dsl/compiler/include/logicpilot/dsl/stdlib_core.h`、`dsl/compiler/tests/golden/move_route_ir_dump.txt`、`libraries/core.lplib`。
- `dsl/lsp/main.cpp`、`scripts/gen-stdlib-header.mjs`（改）。
- 建议 message：`feat(dsl): stdlib core and registry semantics`

### B8 · IDE 执行客户端与状态
- `web/apps/ide/src/client/executionClient.ts`（新）+ 测试；`src/state/{executionStore,executionProjector,legacyGateway}.ts`（新）+ 测试。
- `web/apps/ide/scripts/`：`execution-endpoint.mjs`、`.d.mts`、`plugin-catalog-bridge.mjs`、`ai-endpoint.mjs`、`browser-verify.mjs`（改），`execution-artifacts.mjs`、`native-session-provider.mjs`（新）。

### B9 · 3D 场景（独立新能力）
- 新包 `web/packages/scene3d/**`（含 6 个测试 + tsconfig + README）。
- `web/apps/ide/src/scene3d/**`、`plugins/builtin/scene3d/**`、`state/sceneStore.ts`、`styles/scene3d.css`、`plugins/builtin/telemetryProjectors.ts`。
- `web/apps/ide/scripts/scene3d-verify.mjs`、`scripts/test-scene3d-browser.mjs`。
- 建议 message：`feat(scene3d): spatial scene package and IDE panel`
- 验证：`node scripts/test-scene3d-browser.mjs`。

### B10 · IDE 插件 / 范式生命周期重构
- `web/apps/ide/src/plugins/**`（`host.ts`、`registry.ts`、`registries/*`、`builtin/*/activate.ts|plugin.json`）。
- `src/workbench/{palette,outline}.ts`、`src/model/paletteContributions.ts`、`src/layout/**`、`src/sysml/**`、`src/project/**`（含新测试）、`src/App.tsx`、`src/styles/**`、`package.json`、`vite.config.ts`、`README.md`。
- `web/apps/ide/scripts/paradigm-lifecycle-verify.mjs`（新）。
- 建议 message：`refactor(ide): route paradigms through plugin lifecycle`
- 验证：`pnpm --filter @logicpilot/ide run verify:paradigm-lifecycle`。

### B11 · Artifact Store 原子性
- `web/packages/artifact-store/`：`index.ts`、`outbox.ts`、`node-shims.d.ts`（改），`atomic-file.ts`、`lock.ts`（新）+ 测试。

### B12 · 桌面壳（Tauri）
- `desktop/src-tauri/{Cargo.toml,Cargo.lock,src/main.rs}`（改）、`src/windows_job.rs`（新）——`KILL_ON_JOB_CLOSE` 作业对象兜底回收。
- 建议 message：`feat(desktop): job-object process cleanup`

### B13 · 文档（含 DSH 支线）
- `docs/`：`adr/`（0134–0136 新 + 0092/0133 改 + index）、`architecture/`（`current-state.md`、`canvas-platform.md`、`next-generation-plugin-platform.md` 新/改，`dsh-modeling-cocreation-plan.md`、`execution-session-gateway-plan.md` 新）、`maintenance/`（18 份 09-04/09-05 报告 + DSH 三件套）、`guide/`、`specs/`、`workbench-*.md`、`roadmap.md`、`README.md`。
- `integrations/dsh-des/**`（新，原型参考）。
- 建议 message：`docs: record runtime plugin and execution session boundaries`

## 执行注意

1. **不要 `git add -A`**：`runtime/component-runner/target/` 虽被 ignore，但建议逐批 `git add <path>`。
2. **C++ 改动不走裸 CMake**：用 `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test`（改 CMake 加 `-Configure`）。
3. **生成物与契约同批**：B1 内 schema 与其生成物必须一起提交，否则门禁会红。
4. **推送是外部动作**：278 个历史提交 + 上述各批是否推送远端，请用户明确授权后再执行。
5. 若某批验证不过，**就地修，不要跳过测试或扩大容错**（项目既有纪律）。

## 本次实测证据（2026-10-11）

Node / 契约层门禁：

| 门禁 | 结果 |
| --- | --- |
| `check-wit-contract.mjs` | ✅ OK: logicpilot:plugin@1.0.0 host/lifecycle/service world |
| `check-kernel-boundary.mjs` | ✅ OK: 662 includes / 102 core files / 20 method headers |
| `check-contract-conform.mjs` | ✅ OK: 18 schemas / 124 definitions |
| `test-kernel-boundary.mjs` | ✅ PASS |
| `test-plugin-lifecycle.mjs` | ✅ PASS |
| `test-execution-boundary.mjs` | ✅ PASS |
| `test-runtime-adapters.mjs` | ✅ PASS |
| `test-runtime-conformance.mjs` | ✅ PASS |

前端：

| 项目 | 结果 |
| --- | --- |
| IDE vitest（`pnpm --filter @logicpilot/ide run test`） | ✅ 71 文件 / **417 通过** / 1 skip（418） |
| 全仓库 typecheck（`pnpm -r run typecheck`） | ✅ EXIT=0（editor / artifact-store / renderer2d / agent-openai / **scene3d** / canvas / ide 全过） |
| editor vitest（round-trip 门禁） | ✅ 10 文件 / **76 通过** |

> 未验证：C++ 构建/CTest、浏览器 E2E、桌面打包 —— 需按 B5/B10 的验证命令各自执行。
> 说明：IDE 用例数已从交接文档记录的 340 增至 **418**，增量主要来自本批未提交的 `executionClient`、`executionStore/Projector`、`scene3d`、`openProject`、`explorerRoot`、`modelingLoop` 等新测试。
