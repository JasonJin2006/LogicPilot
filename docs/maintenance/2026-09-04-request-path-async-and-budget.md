# 2026-09-04 请求路径全异步化与执行预算上限

起点：上一份 `2026-09-04-kernel-async-supervisor.md` 完成后继续。目标：
把剩余请求路径的同步 `execFileSync`（`/api/ai-optimize`、`/api/ai-explain`）迁到异步 supervisor，
并给 `/api/execution` 加服务端预算上限。

## 完成了什么

| 范围         | 修复与影响                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 共享 runner  | `ai-build.mjs` 导出 `prepareLpcli`/`runLpcliAsync`；`optimize.mjs`、`ai-optimize.mjs`、`ai-explain.mjs` 改为复用（消除三处重复的 mingw PATH hack 与各自漂移的 PATH 逻辑偏差；`ai-explain` 之前还缺少 `extendNativeRuntimePath`） |
| optimize     | `optimize()` 的 score 循环（每个候选 compile+run）改为 `await runLpcliAsync`；`aiOptimize` 的 declare 编译步同样异步。网格/GA 搜索不再阻塞请求线程 |
| explain      | `aiExplain` 的两处 compile 与 run 全部异步；错误路径行为不变（异常向上抛，由端点统一处理）                                                  |
| 预算上限     | `execution-endpoint.mjs`：`MAX_EXECUTION_WALL_MS = 10min`。未传 `budget` 的请求获得该默认值；`budget.maxWallMs` 超过上限在注册表查询/归档等任何副作用前以 400 拒绝。`maxSteps` 语义不变 |
| 验收         | `test-execution-boundary.mjs`：mock 记录 `request.budget`，断言缺省预算为上限值、超限请求 400 且未到达 executor、恰为上限可执行                              |

## 验证记录（本轮实际运行）

| 门禁                                              | 本轮结果                                     |
| ------------------------------------------------- | -------------------------------------------- |
| `node scripts/test-optimize.mjs`                  | PASS（grid + GA + aiOptimize 端到端）        |
| `node scripts/test-explain.mjs`                   | PASS                                         |
| `node scripts/test-execution-boundary.mjs`        | PASS（含新预算上限断言）                     |
| `node web/apps/ide/scripts/test-ai-endpoint.mjs`  | PASS（optimize/explain/validate/run 端点）    |
| `node scripts/test-runtime-adapters.mjs`          | PASS                                         |
| `pnpm test:app-server`                            | PASS                                         |
| `pnpm desktop:stage` + `pnpm desktop:test-staged` | PASS；76 文件；含默认预算下的首个执行         |
| `pnpm test`（全量，后台运行轮询）                 | PASS；IDE 387 passed / 1 skipped；0 failed   |

未运行：MSVC 构建（无 C++ 改动）、浏览器 E2E、zero-paradigm（与本次改动无关）。
过程中一次 `test-ai-endpoint` 报 Node 崩溃，随后独立/顺序重跑均 PASS，未复现，暂记为环境抖动，
后续门禁未出现。

## 剩余边界

- HTTP 请求断开、请求策略 504 不会取消底层执行；app-server 强杀时 Windows 无 Job Object 兜底。
- `maxSteps` 与服务端 AI 端点预算语义未统一；`/api/ai-optimize` 内部搜索有自身 `budget`（评估次数），
  与执行 wall-clock 无联动。
- POSIX 进程组 SIGKILL 分支未在 Windows 实机触发过，按 Node 语义实现。
