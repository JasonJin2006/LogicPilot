# 2026-09-04 执行取消与 service.call 截止时间修复

起点：`2026-09-04-request-path-async-and-budget.md` 完成后的剩余执行生命周期问题。
目标：客户端断开/请求策略超时能取消底层内核执行；长预算执行不被 broker 的 10 秒激活超时截断。

## 问题与修复

| 问题                                                       | 修复                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 断开/504 后底层 lpcli 仍在跑（孤儿执行）               | `app/request-policy.mjs` 为每个请求挂 `REQUEST_CANCEL_SIGNAL`（AbortSignal），超时/并发拒绝时 abort；`execution-endpoint.mjs` 在响应未完成时 `res close` 或策略 abort → `cancelKernelRun(requestId)`                                                            |
| 取消无法到达内核子进程                                     | 桥接层按 requestId 注册 `AbortController`（同一 id 并发使用 Set 全量中止），entrypoint 的 kernel.call 携带 `requestId`；`runRuntimeModel`/`runModelDsl` 透传 `signal` 到 supervisor（compile/run/replay/verify 全部受控）；运行时预中止直接 RT0005，HTTP 预取消在执行前返回 499 |
| broker 10 秒 deadline 截断长执行（>10s 被超时返回但子进程继续） | `serviceCallDeadlineMs`：`runtime.service.call` 的 deadline = 请求 `budget.maxWallMs + 30s` margin；无预算时回退激活超时。普通 capability 请求不变                                                       |
| 端点对已销毁 socket 写响应                                  | `send()` 增加 `res.destroyed` 守卫；断开后到达的 catch/success 不再写坏 socket                                                                                                                        |

## 验证记录（本轮实际运行）

| 门禁                                             | 本轮结果                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `node scripts/test-request-policy.mjs`           | PASS；新增：req 上存在取消信号、超时后该信号 aborted                                                    |
| `node scripts/test-runtime-adapters.mjs`         | PASS；新增：预中止信号 → 立即 RT0005，不 spawn lpcli                                                    |
| `node scripts/test-execution-boundary.mjs`       | PASS；新增：执行中断开连接 → cancelRun(requestId)；预中止策略信号 → cancelRun                           |
| `pnpm --filter @logicpilot/plugin-catalog test`  | PASS；59/59（新增 serviceCallDeadlineMs 单测：预算 +30s、无预算/非法回退）                              |
| `pnpm typecheck` / `pnpm lint:ci` / `pnpm format:check` | PASS（lint 0 warnings）                                                                                 |
| `pnpm test:app-server` / `test-kernel-supervisor` / `test-ai-endpoint` | PASS                                                                                                   |
| `pnpm desktop:stage` + `desktop:test-staged`     | PASS；新增段：客户端在 30s 预算执行期间中止 fetch → 10s 内 tasklist 无 lpcli.exe、随后心跳正常            |

未运行：MSVC 构建（无 C++ 改动）、浏览器 E2E、zero-paradigm。
预计全量 `pnpm test` 结果单独记录（`build/maintenance-pnpm-test-3.log`）。

## 剩余边界

- app-server 被强杀时无 Job Object 兜底（Tauri 强退路径未验证）；POSIX 进程组 SIGKILL 未在 Windows 实机触发。
- 取消是协作式：已开始的子进程被 supervisor 杀掉，未开始的调用快速失败；`persist` 阶段不受取消控制。
- `maxSteps`、`/api/ai-run` 等 AI 端点仍无服务端执行时长约束。
