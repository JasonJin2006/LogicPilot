# 2026-09-04 Node refresh/session 生命周期收口

起点：Artifact Store/outbox 原子性之后的下一个 P1。目标：把 NodePluginRuntime 的 session 生命周期做对——
可配 TTL、可续期、失败 refresh 后“保留旧 host 仍可用”，并补 stale generation/stop-start/uninstall 的验收。

## 改了什么

| 范围        | 改动                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| broker 会话 | `capability-broker.ts`：新增 `renewSession(sessionId, ttlMs)`（滑动续期，只改 expiresAt）与 `sessionInfo(sessionId)`；`CapabilityBrokerOptions.renewTtlMs`（成功后滑动刷新过期时间）；这些都不影响在途调用的 deadline |
| 会话 TTL    | `NodePluginRuntimeOptions.sessionTtlMs`（默认 10 分钟）代替 `createHost` 里的硬编码，并透传给 broker 作 renewTtlMs                    |
| 失败 refresh 回滚 | `refreshFresh`：捕获 `previousSessions`；`next.start()` 或 owner 校验失败时 `revokeSessions(newGen)` 后恢复 `this.sessions = previousSessions`，使“保留旧 host”时其 capability/service 仍可 dispatch |
| 成功撤销旧代 | 成功刷新在 `revokeGeneration(prevGen)` 后调用 `revokeSessions(prevGen)` 清理 map 中已移除插件的陈旧条目；`previous.stopAll()` 异常路径同样回滚 sessions |
| 字段可变性   | `this.sessions` 由 readonly 改为可变以支持回滚                                                                                     |

## 验证记录（本轮实际运行）

| 门禁                                        | 本轮结果                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @logicpilot/plugin-host test` | PASS；87/87（新增：session-expired、generation-retired、renewSession 延长、renewTtlMs 滑动续期） |
| `pnpm --filter @logicpilot/plugin-catalog test` | PASS；61/61（新增：失败 refresh 保留旧代可执行且 capability 可 dispatch；成功 refresh 撤销旧代；stop→start 复活；卸载式 refresh 反映 inactive + 空 target 列表） |
| `pnpm -r --filter @logicpilot/plugin-catalog... build` | PASS（bundle 521.5kb）                                            |
| `node scripts/test-execution-boundary.mjs` / `test-runtime-adapters.mjs` / `test-ai-endpoint.mjs` | PASS |
| `pnpm typecheck` / `pnpm lint:ci` / `pnpm format:check` | PASS（lint 0 warnings）                                             |
| `pnpm desktop:stage` + `desktop:test-staged` | PASS；76 文件                                                        |
| `pnpm test`（全量，后台轮询）                | PASS；IDE 387 passed / 1 skipped；0 failed                            |

未运行：MSVC `windows-build.ps1`（无 C++ 改动）、浏览器 E2E、zero-paradigm。

## 剩余边界

- refresh 运行中替换无请求栅栏：`previous.stopAll()` 会 terminate 旧 worker，在途执行以 `isolated ESM worker stopped` 结束，
  无静默排空/在途计数；stop() 与 refresh() 并发语义未定义。
- 卸载无 HTTP 端点：`PackageManager.uninstall` 未接到 runtime（只有 watch 轮询 2s 后 refresh 兜底），
  bridge 无 uninstall 路由。
- `runtime.service.provide` 仍是空操作、service.call 无方法白名单/所有权/schema/disposer——服务协议是下一个 P1。
