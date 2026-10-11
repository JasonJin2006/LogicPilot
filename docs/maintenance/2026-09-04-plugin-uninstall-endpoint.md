# 2026-09-04 插件卸载 HTTP 端点

起点：地基缺口第 4 项。目标：补上应用层装/卸范式插件的操作面——卸载是操作者决策，
应有直接端点；安装仍走 draft 审批链（不新增绕过审批的安装入口）。

## 做了什么

| 范围              | 内容                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| POST /api/plugins | `handlePlugins` 增加 POST 分支（GET 保持原只读视图）：`{ action: 'uninstall', pluginId }` 走       |
|                   | `PackageManager.uninstall`（依赖检查、staged 移除、审计记录），错误码映射：`not-installed`→404、   |
|                   | `dependency`→409、`invalid-manifest`/`api-version`→400、存储失败→500；成功后立即                   |
|                   | `nodePluginRuntime.refresh()` 换代（执行 target/session/service 即刻撤销，不等 watch tick）；      |
|                   | 换代失败不回滚持久卸载，`runtimeRefreshError` 字段透传边界（与 draft install 相同语义）。          |
|                   | 请求体上限 1MiB（复用既有 readArtifactBody）。                                                     |
| 验收              | `scripts/test-plugin-lifecycle.mjs`（根 `pnpm test:plugin-lifecycle`）：真实                       |
|                   | NodePluginRuntime + 真实 store/lockfile + 真实 HTTP handler——卸载未知插件 404；                    |
|                   | 卸载已装插件 200 且 runtime 代际立即换代（isActive=false、execution target 消失、lockfile 清空）； |
|                   | 重复卸载 404；畸形请求 400（action 缺失/非 uninstall、无 pluginId、非法 JSON）；                   |
|                   | 恢复 lockfile 条目 + refresh 后 target 回归（重装/重批准同路径）。                                 |

## 验证记录（本轮实际运行）

| 门禁                                             | 结果                    |
| ------------------------------------------------ | ----------------------- |
| `node scripts/test-plugin-lifecycle.mjs`         | PASS（两次实跑）        |
| `node scripts/test-execution-boundary.mjs`       | PASS（回归）            |
| `node web/apps/ide/scripts/test-ai-endpoint.mjs` | PASS（回归）            |
| `pnpm desktop:stage` + `desktop:test-staged`     | PASS；78 文件（回归）   |
| `pnpm typecheck` / `lint:ci` / `format:check`    | PASS（lint 0 warnings） |

未运行：全量 `pnpm test`（后台进行中）、MSVC、浏览器 E2E。

## 剩余边界

- 浏览器 builtin 范式不经 PackageManager（静态编译进 bundle）；卸载端点只作用于 Node runtime 的
  lockfile 插件。浏览器侧运行时卸载仍只有 `host.stop` 编程缝隙（paradigm-lifecycle 门禁覆盖）。
- 无批量卸载/降级端点；安装仍只能通过 draft 审批链（有意为之）。
