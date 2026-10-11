# 2026-09-04 Palette 跟随活动文档(按 DocumentType 上下文过滤)

起点：用户体验反馈“palette 没有跟着 canvas 走”。工作台架构计划 §2/§5/§9 明确点名
“Palette 使用固定 library union”为必须纠正的现有边界，目标契约 `PaletteProvider` 的
扩展职责包含“上下文条件”。本切片落地该上下文过滤。

## 做了什么

| 范围     | 内容                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约     | `PaletteContribution` 新增 `context?: { documentTypes?: string[] }`：声明该库适用的工作台文档类型；`PaletteRegistry.forDocumentType(docTypeId)` 过滤——声明的按集合精确匹配，未声明的(legacy)对任何已知文档类型可见，**普通文件(无文档类型)一律无范式库** |
| 内置声明 | 模型 8 库(`registerModelPaletteContributions`)→ `['dsl']`；SysML 库 → `['sysml']`                                                                                                                                                                        |
| 面板     | `PalettePanel` 订阅 `activeFile` 解析活动文档类型；tabs、条目、'all'/'recent' 视图全部按适用贡献过滤；无适用贡献时显示空态(“No element library for this file/doc”)；`endDrag` 的文档类型判定复用已计算值                                                 |
| 双轨过滤 | 结构化(CreateAction)`structuredPaletteItems` 条目只在所属库适用于当前文档时并入 defs/tabs                                                                                                                                                                |
| 验收     | `palette.test.ts` 新增上下文过滤用例（dsl 含 process 不含 sysml、sysml 仅 sysml、plain 为空、legacy 兼容）；`paradigm-lifecycle-verify.mjs` 新增浏览器三段断言：打开 .lp → 面板含 process 无 SysML；切 .sysml → 含 SysML 无 process；打开纯文本 → 空态   |

## 验证记录（本轮实际运行）

| 门禁                                          | 结果                                                    |
| --------------------------------------------- | ------------------------------------------------------- |
| `pnpm --filter @logicpilot/ide test`          | PASS；65 文件 389 passed / 1 skipped（+1 palette 用例） |
| `pnpm test:paradigm-lifecycle`                | PASS；含 .lp/.sysml/纯文本三态文档切换断言              |
| `pnpm typecheck` / `lint:ci` / `format:check` | PASS（lint 0 warnings）                                 |
| `pnpm desktop:stage` + `desktop:test-staged`  | PASS；78 文件（体验服务器已用新前端重启）               |

未运行：全量 `pnpm test`（后台进行中）、MSVC、zero-paradigm（不受影响，未声明贡献场景保持兼容）。

## 剩余边界

- 结构化 CreateAction 条目的 documentTypes 标签需要契约级字段（contributions schema 改版 + gen-contracts + MSVC）；当前在面板做库级过滤，条目级标签未做。
- `endDrag` 仍按活动文档类型选择画布目标（.sysml vs .model）——属 §9 第 4 步 DiagramProvider 迁移范围。
- SysML/C4 共用画布规则与按插件的浏览器卸载 UI 未做。
