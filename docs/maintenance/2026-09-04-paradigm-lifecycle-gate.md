# 2026-09-04 Shell 范式生命周期门禁

起点：地基缺口清单第 3 项（Shell/Palette 去范式化边界）。目标：在拆除静态耦合之前，
先用真实浏览器运行时定义边界——范式表面必须跟随插件生命周期与发现表，而不是静态导入。

## 做了什么

| 范围               | 内容                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zero-paradigm 基线 | 首次在本机实跑 `pnpm test:zero-paradigm`：零插件构建启动、骨架渲染、全部范式注册表为空、普通文件可编辑—— PASS                                                                                                                                                                                                                                 |
| host 访问器        | `web/apps/ide/src/plugins/host.ts` 新增 `idePluginHost()` 导出（返回当前活动宿主），供运行时 per-plugin 生命周期与验证门禁使用                                                                                                                                                                                                                |
| 生命周期门禁       | 新增 `web/apps/ide/scripts/paradigm-lifecycle-verify.mjs`（根 `pnpm test:paradigm-lifecycle`）：默认构建全范式基线 → 运行时 `host.stop('logicpilot.sysml')` 只撤销 sysml 的 document/palette/panel（process/DSL 不受影响、palette 宿主仍渲染）→ 停宿主后以仅 sysml builtin 重启，贡献集精确跟随发现表（宿主级卸载语义），全程无致命控制台错误 |

**边界结论（真实发现）**：workbench 贡献层（document/palette/panel 注册表）已经完全跟随插件生命周期——
`ctx.effect` 注册、`host.stop` 撤销、发现表决定集合。去范式化的剩余工作是**双轨合并**
（旧运行时 palette contribution vs 结构化 CreateAction）、SysML/C4 共用画布规则、
以及把 `host.stop` 暴露成卸载 UI，而不是搬迁注册表本身。

## 验证记录（本轮实际运行）

| 门禁                                          | 结果                                                   |
| --------------------------------------------- | ------------------------------------------------------ |
| `pnpm test:zero-paradigm`                     | PASS（生产零插件构建 + dev server + Edge 无头）        |
| `pnpm test:paradigm-lifecycle`                | PASS（首次运行即过：基线/单插件 stop/单 builtin 重启） |
| `pnpm --filter @logicpilot/ide test`          | PASS；65 文件 388 passed / 1 skipped                   |
| `pnpm typecheck` / `lint:ci` / `format:check` | PASS（lint 0 warnings）                                |

未运行：全量 `pnpm test`（本轮只改 host.ts 一个导出 + 新脚本，IDE 套件已覆盖）、MSVC、staged。

## 剩余边界

- 浏览器侧无按插件的卸载 UI（只有 `host.stop` 编程缝隙）；`PackageManager` 的安装/卸载 HTTP 端点仍未接。
- Palette 双轨（运行时 contribution vs 结构化 CreateAction）与 SysML/C4 共用画布规则仍是待拆的静态耦合主体。
