# 2026-09-04 Worker service 协议

起点：Node refresh/session 生命周期之后的下一个 P1。目标：移除 `runtime.service.provide = () => undefined`
空操作，让插件能真正注册并在跨 worker 间调用服务，带所有权、方法白名单、disposer 与审计拒绝。

## 改了什么

| 范围               | 改动                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务协议类型       | `PluginModule.callService(name, method, args)`（isolate worker 模块暴露，供宿主路由跨 worker 调用）                                                                                                |
| worker 侧          | `dynamic-loader.ts`：`ctx.service(name)` 改为按方法分发的 Proxy（`{name, method, args}` 载荷，替代旧的单一 `.call`）；`ctx.provide(name, service)` 改为请求/响应（非 fire-and-forget），成功后存入 worker 本地 `provided`，被拒时返回 `{ok:false}` 而非静默成功；worker 处理 `service-call` 消息执行提供服务的方法；activate 后 `provided` 保留、deactivate 清空 |
| 宿主侧             | `node-runtime.ts`：`runtime.service.provide` 在校验名称/方法后把服务登记进 `serviceRegistry`（owner=pluginId、generation、方法白名单、路由模块），重复名称拒绝（`service-exists`）；`runtime.service.call` 按 `{name, method, args}` 分发：worker 提供的服务校验方法白名单（`method-not-allowed`）后经 `callService` 路由回提供者；宿主注入服务走原 kernel 分支（不变），不可用/不可调用以 `CapabilityDeniedError` 透传（`service-unavailable`/`not-callable`） |
| disposer           | `disposeGenerationServices(generation)`：refresh 成功撤销旧代时清掉该代提供的服务；stop() 清空全部                                                                                                 |
| 测试               | node-runtime.test.ts 新增：跨 worker 调用返回结果（provider 提供 `svc.call(21)` → caller 得 42）、方法白名单拒绝（`bogus` → `method-not-allowed`）、重复提供者拒绝（`service-exists` 可观察且原服务仍路由）、generation 卸载后服务不可用（`service-unavailable`） |

## 验证记录（本轮实际运行）

| 门禁                                        | 本轮结果                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter @logicpilot/plugin-catalog test` | PASS；63/63（新增 2 个 service 协议用例）                                                  |
| `pnpm -r --filter @logicpilot/plugin-catalog... build` | PASS（bundle 525.3kb）                                                           |
| `pnpm typecheck` / `pnpm lint:ci` / `pnpm format:check` | PASS（lint 0 warnings）                                                            |
| `node scripts/test-execution-boundary.mjs`   | PASS                                                                                         |
| `pnpm test:app-server`                        | PASS                                                                                         |
| `pnpm desktop:stage` + `desktop:test-staged` | PASS；76 文件（含 deadline 清场 + 客户端中止等待加长的稳健化）                               |
| `pnpm test`（全量，后台轮询）                 | PASS；IDE 387 passed / 1 skipped；0 failed                                                    |

未运行：MSVC `windows-build.ps1`（无 C++ 改动，不改契约生成物）、浏览器 E2E、zero-paradigm。

说明：staged 的“客户端中止后 lpcli 回收”断言偶发受 Windows 进程回收与 tasklist 轮询的时序影响，
已加 deadline 执行后的清场等待与中止等待加长以显著降频；该断言在 10 连跑中稳定通过。

## 剩余边界

- 服务名/方法未在 manifest 契约中声明（运行时只校验形状）；完整 schema 需契约改版（gen-contracts + baseline + MSVC）。
- 非 isolate 路径不提供 `callService`（生产恒 isolate，dev 路径无跨 worker 服务）。
- 提供可调用服务需 `runtime.service.provide` 授权；无授权的 provide 会非致命地返回 `{ok:false}`（仅 marker 无害）。
- refresh 运行中替换无请求栅栏、卸载无 HTTP 端点仍待后续。
