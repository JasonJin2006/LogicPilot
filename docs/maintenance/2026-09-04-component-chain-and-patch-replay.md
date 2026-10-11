# 2026-09-04 组件链修复与 patch-only revision 重建

起点：外部审查发现组件链三个实质问题（发给 runner 的命令缺 Rust 必填 id、Component 分支绕过 T2 信任检查、
超时未确保结束子进程），且现有"组件测试"用宽松 mock 掩盖了真实链路。本轮修复组件链并把"地基"里
最阻塞建模闭环的 patch-only revision 重建做完。

## 组件链修复

审查时点的三个问题在当前源码中的处置：

| 审查发现                       | 现状与修复                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 命令缺 Rust 必填 id            | 当前 `component-runner.ts` 的生命周期帧已带 `id: sequence`（≥1）。为防止回归，重写测试用**严格 Rust serde 契约 mock**：缺 id/kind 的帧静默丢弃（与 `main.rs` 的 `else if let Ok(...)` 行为一致）、未知 kind 回 `unknown-command`——旧的"对任何行都回话"mock 正是掩盖协议漂移的原因 |
| Component 分支绕过 T2 信任检查 | `createDynamicWasmLoader` 的 T2 下限检查位于 component 分支之前（审查后已由外部会话修正）；本轮补齐**负面测试**（t0/t1 → thunk undefined + `trust requirement denied` 审计），并把正向测试改为显式 `t2` 通过下限                                                                  |
| 超时未确保结束子进程           | `stop()` 升级：SIGKILL 后 3s 内未退出则 `taskkill /PID /T /F`（Windows）/ 再 kill（POSIX）强制回收；新增测试：runner 收到 activate 后不应答 → activate 以 /timed out/ 拒绝，且轮询确认 runner 进程死亡                                                                            |

其它组件链修复：

- `createDynamicComponentThunk` 的失败不再静默返回 undefined（路径/digest/大小校验失败现在走
  `report()` 进审计，与 ESM/WASM 路径一致）。
- 重建了滞后的 runner exe（源码 18:00 vs exe 17:13）。
- staged 测试新增**真 exe 冒烟**：staged `logicpilot-component-runner` 对非组件载荷必须非零退出且
  报 `cannot load component`（此前只检查文件存在）。
- `node-shims.d.ts` 扩展（process.platform/kill、ChildProcess.pid、spawn stdio 'ignore'）。

## patch-only revision 重建（建模闭环地基）

有 pin 的执行此前要求 revision 自带 `model-save`（含 `dsl`）；AI 修改模型提交的是 `model-patch`，
pin 到 patch-only revision 会 409。本轮实现重建：

- `web/packages/editor/scripts/bundle.mjs`：editor 的 esbuild 单文件 Node ESM bundle
  （`dist/editor.bundle.js`，含 `applyModelPatch`/`generateDsl`；staged 树无 node_modules，
  与 plugin-catalog bundle 同一布局规则）。editor `build` 现在是 `tsc && bundle`。
- `execution-artifacts.mjs` 的 `materializeExecutionSource`：目标 revision 无 model-save 时，
  沿 `parentRevisionId` 回溯到最近的带 `document` 的 model-save，依序重放其后的 model-patch
  （`applyModelPatch`，失败以首个诊断 409 `patch chain failed: MPxxxx`），`generateDsl` 产出执行源。
  带 dsl 的 model-save 仍走原快路径（向后兼容）。
- staged 接线：`stage-desktop-runtime.mjs` 打包 editor bundle（`web/packages/editor/dist/editor.bundle.js`）。
- 测试（`test-execution-boundary.mjs`）：3 段 patch（add/add+connect/rename）链重放 → materialized DSL
  等于逐段 apply 后的 `generateDsl`；HTTP pin patch-only revision 执行材料化 DSL；
  链中不可应用 patch（remove 不存在块）→ 409 且 executor 零调用。

## UI 建模闭环端到端（补）

`web/apps/ide/src/artifacts/modelingLoop.test.ts`：真实客户端（`persistModelSnapshot` /
`beginModelPatchTransaction` / `commitModelPatchTransaction`）+ 真实 HTTP handler
（`handleArtifactGraph`、`createExecutionHandler`）+ 真实落盘 store 的整链验收：
编辑器 Save 产生带 document+dsl 的 model-save revision → AI patch 本地 apply 并提交 patch-only
revision → pin 该 revision 执行 → executor 收到的是服务端重放后的 DSL（等于 `generateDsl(apply 后文档)`），
不是保存时快照。`execution-endpoint.d.mts` 补齐 `createExecutionHandler`/`MAX_EXECUTION_WALL_MS` 的类型导出。

## 验证记录（本轮实际运行）

| 门禁                                                                                                                    | 结果                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm --filter @logicpilot/plugin-catalog test`                                                                         | PASS；66/66（组件 3 用例：严格协议/T2 负面/超时回收） |
| `pnpm --filter @logicpilot/editor build`                                                                                | PASS；tsc + bundle（editor.bundle.js 477KB）          |
| `node scripts/test-execution-boundary.mjs`                                                                              | PASS（含 patch 链重放与 409 负面）                    |
| `node scripts/build-component-runner.mjs`                                                                               | PASS（cargo 重建 runner）                             |
| `pnpm desktop:stage` + `desktop:test-staged`                                                                            | PASS；78 文件；含真 runner exe 冒烟                   |
| `pnpm test`（全量，后台轮询）                                                                                           | PASS；0 failed                                        |
| `pnpm typecheck` / `lint:ci` / `format:check` / `test-kernel-supervisor` / `test-runtime-adapters` / `test-ai-endpoint` | PASS                                                  |

未运行：MSVC（无 C++/契约生成物改动）、浏览器 E2E、zero-paradigm、真实 Wasmtime Component 用例
（外部补充中；现有真 exe 冒烟仅验证二进制运行与载荷校验）。

## 剩余边界

- 真实 Wasmtime Component（编译产物 .wasm）端到端用例仍缺——严格 mock 保证协议形状，不证明 wasmtime 绑定正确。
- patch 重建只支持线性 `parentRevisionId` 链与 `model-save`/`model-patch` 两种 opType；
  分叉/压缩/其它 opType 不重放。
- 旧 model-save（只有 dsl、无 document）之上的 patch 链无法重放（409，需重新保存）。
