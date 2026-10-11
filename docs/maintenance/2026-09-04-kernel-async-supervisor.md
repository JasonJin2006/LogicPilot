# 2026-09-04 kernel service 异步 supervisor 记录

起点：HEAD `debbac2`，工作树保留前几轮未提交 runtime/契约改动（含本轮的清理与契约演进）。
本报告只覆盖本轮完成的范围与验证，不代表整个平台计划完成。

## 完成了什么

| 范围                 | 修复与影响                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| 子进程 supervisor    | 新增 `scripts/subprocess-supervisor.mjs`：异步 `execFileAsync`，timeout/abort 回收整棵进程树（Windows taskkill /T /F，POSIX 进程组 SIGKILL），settle 后清监听、销毁管道、unref，输出 32MB 上限；失败带 exitCode/stdout/stderr，超时给 `ProcessTimeoutError` |
| kernel service 异步化 | `runModelDsl`/`runRuntimeModel`/`validateModelDsl`/`buildModel` 改为 async；`/api/execution` kernel service、`/api/ai-run`、`/api/ai-build`、`/api/ai-validate` 不再阻塞事件循环。compile/run/replay 共用同一个 `maxWallMs` deadline（每阶段取剩余预算） |
| 拒绝语义             | 新增 `CapabilityDeniedError`；runtime owner 不匹配回传 `runtime-not-owned` deny 而非泛化 `handler-failed`，并进入 host audit 日志；Worker 侧 capability-response 与 execute/activate 错误携带根因 |
| Worker 生命周期缺陷  | 修复 ESM 控制器：worker 已被 terminate（拒绝/失败路径）后，后续 deactivate 立即返回、execute 快速失败，不再对死 worker postMessage 后空等 10 秒 |
| staged 打包          | `stage-desktop-runtime.mjs` requiredFiles 增加 `scripts/subprocess-supervisor.mjs`（staged app server 依赖它，漏打包会 dynamic import 失败） |
| 验收                | 新增 `scripts/test-kernel-supervisor.mjs`（`pnpm test:kernel-supervisor`）与 node-runtime 拒绝先于副作用的 vitest 用例；staged 集成测试增加“长任务期间 GET / 心跳 < 1s + 1.2s 预算被回收 + RT0005”断言 |

## 验证记录（本轮实际运行，未复用旧会话数字）

| 门禁                                                    | 本轮结果                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `node scripts/test-kernel-supervisor.mjs`               | PASS；成功输出/非零退出/ENOENT/超时树回收（父+孙进程死亡）/abort 取消/并发 HTTP 心跳 <1s/无残留 ChildProcess 句柄 |
| `node scripts/test-runtime-adapters.mjs`                | PASS；四种范式 + RT0001 前置拒绝 + replay 冻结 seed/count          |
| `pnpm --filter @logicpilot/plugin-catalog test`         | PASS；58/58（新增拒绝用例；原 57）                                 |
| `node scripts/test-runtime-conformance.mjs`             | PASS                                                              |
| `node scripts/test-execution-boundary.mjs`              | PASS                                                              |
| `node scripts/check-contract-conform.mjs`               | PASS；16 schemas / 114 definitions（无 schema 变更）               |
| `pnpm typecheck` / `pnpm lint:ci` / `pnpm format:check` | PASS（lint 0 warnings；prettier 修复两个文件后 PASS）              |
| `pnpm test:app-server`                                  | PASS                                                              |
| `pnpm desktop:stage` + `pnpm desktop:test-staged`       | PASS；76 个 staged 文件；含新增心跳/deadline 段                    |
| `pnpm test`（全量）                                     | PASS；IDE 387 passed / 1 skipped，plugin-catalog 等全绿            |

未运行：浏览器交互 E2E、zero-paradigm 浏览器门禁、MSVC `windows-build.ps1`（本轮无 C++ 改动）、
`pnpm docs:build`（文档更新后单独跑了，见下方状态）。POSIX 进程组 SIGKILL 分支在 Windows 机器上未实际触发，
只按 Node 语义实现，未在本机验证。

## 剩余边界

- `/api/ai-optimize`、`/api/ai-explain` 仍走同步 `execFileSync`（`scripts/ai-optimize.mjs`/`ai-explain.mjs`），
  与旧 kernel service 相同的阻塞问题，未迁移。
- 未传 `budget.maxWallMs` 的执行请求没有服务端硬上限；broker 的 activationTimeoutMs 不约束执行时长。
- 父进程被强杀时 Windows 无 Job Object 兜底，正在运行的 lpcli 可能残留；Tauri 强退路径未验证。
- supervisor 的 abort 目前只对显式传入的 AbortSignal 生效；HTTP 请求断开不会自动取消执行。
- 请求策略的 `API_REQUEST_TIMEOUT_MS` 504 只发响应，不取消底层执行。
