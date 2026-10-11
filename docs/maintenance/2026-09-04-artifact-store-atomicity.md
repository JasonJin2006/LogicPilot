# 2026-09-04 Artifact Store / outbox 原子性收口

起点：执行生命周期切片之后的下一 P1。目标：消除 Windows rename fallback 的“先删后换”崩溃窗口、
给锁加所有权、把 outbox 的 read-modify-write 收进锁内并加 claim lease，使其在并发/崩溃下不丢数据。

## 做了什么

| 范围               | 改动                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 原子文件替换       | 新增 `src/atomic-file.ts`：`atomicWriteFileSync`（临时文件含 pid+序号+随机 token，写后 fsync；直接 rename 失败时 target→`.bak`、temp→target、失败恢复 `.bak`；从不先删目标）；`recoverAtomicFile`（target 缺失时还原 `.bak`、清理过期的 `*.tmp-*`）；目录 fsync 在 Windows 上跳过 |
| owner-token 互斥锁 | 新增 `src/lock.ts`：`acquireSharedLock` 返回 token；`releaseSharedLock` 仅 token 匹配才 unlink；stale 且 owner pid 已死的锁才回收（活 pid 永不偷）；短临界区有界自旋（默认 250ms），长持有仍 fail-fast |
| outbox 事务化       | `src/outbox.ts`：enqueue/claimNext/complete/fail/retryDeadLetters/release 全部在持锁内完成 read→transform→atomic write；claim 带 leaseOwner/leaseToken/leaseExpiresAt；complete/fail 校验 leaseToken，非 owner 抛错；lease 过期**或 owner 死亡**才被下次 claim 恢复；构造函数不再无条件重置 processing |
| store              | `src/index.ts`：write/snapshot 走 token 锁 + atomicWrite；read 先 `recoverAtomicFile`；移除“先删后换”与旧 `acquireMutex` |
| 调用适配           | `plugin-catalog-bridge.mjs` drain 把 claim 的 leaseToken 传给 complete/fail；`execution-artifacts.mjs` 无需改（走 bridge drain） |
| 类型 shim          | `src/node-shims.d.ts` 补齐 `openSync/closeSync/fsyncSync/readdirSync/statSync/dirname/basename/randomBytes/process.platform/process.kill` |

## 验证记录（本轮实际运行）

| 门禁                                  | 本轮结果                                                     |
| ------------------------------------- | ------------------------------------------------------------ |
| `pnpm --filter @logicpilot/artifact-store build` | PASS                                               |
| `pnpm --filter @logicpilot/artifact-store test`  | PASS；17/17（原 9 + 新增：.bak 崩溃恢复、temp 清理、活锁不偷、死锁回收、快照完整、lease 过期恢复、非 owner complete 拒绝、两个真实子进程并发 enqueue 不丢、活 owner 不被二次 claim 且死后可回收） |
| `pnpm -r --filter @logicpilot/plugin-catalog... build` | PASS（bundle 519.9kb） |
| `node scripts/test-execution-boundary.mjs` | PASS（真实 store/outbox + drain 的 token 适配）                |
| `node scripts/test-request-policy.mjs`（未挂 package 脚本时直接跑） | PASS |
| `node scripts/test-runtime-adapters.mjs` | PASS                                                         |
| `node web/apps/ide/scripts/test-ai-endpoint.mjs` | PASS                                                    |
| `pnpm typecheck` / `pnpm lint:ci` / `pnpm format:check` | PASS（lint 0 warnings） |
| `pnpm desktop:stage` + `desktop:test-staged` | PASS；76 文件                                |
| `pnpm test`（全量，后台轮询）          | PASS；IDE 387 passed / 1 skipped；0 failed                     |

未运行：MSVC `windows-build.ps1`（无 C++ 改动）、浏览器 E2E、zero-paradigm（与本次改动无关）。

## 剩余边界

- `snapshot()` 的启动自愈未接入（崩溃恢复只覆盖主状态文件，snapshot 需显式触发）。
- 目录 fsync 在 Windows 上无法做到（Node 无法打开目录），因此 OS 掉电/主机关机时不保证重命名后的目录项持久；文件级 fsync 已做。
- 互斥锁为 fail-fast + 有界自旋；短争用由自旋吸收，长持锁会向调用方返回冲突——背景写入需重试而非把它当 500（文档已标注）。
- patch-only revision 重建仍未实现（作为独立后续 P1）。
