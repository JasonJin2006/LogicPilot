# 2026-09-04 前端视觉一致性整理

起因：用户体验反馈“前端有的地方混乱、不规整、不统一”。
本轮先取证（真实浏览器计算样式），再统一，避免凭猜测改样式。

## 取证结果（真实浏览器）

| 发现                            | 证据（computed style）                                                                                        | 结论           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| 三套 tab 形状                   | palette 库条：全圆角 6px、padding 2px 10px；底部/右侧面板 tab：顶圆角 `6px 6px 0 0`、padding 4px 10px       | **真实不统一** |
| 顶栏搜索框胶囊                   | `.search-box` `border-radius: 999px`，全 UI 主圆角语言为 `var(--r-sm)`(6px)                                   | **真实不统一** |
| tab 字号                        | 面板 tab 继承、palette tab 显式 11px                                                                           | **不显式统一** |
| 活动栏图标“无标签”              | 复查 `ActivityBar.tsx`：已有 `aria-label`+`title`（快照只显示符号名）                                         | 误判，撤回     |
| 面板标题“各异”                  | 复查：统一走 `.panel-title`（5px 12px/600）                                                                    | 误判，撤回     |
| 其余 999px                      | 语义化徽章/开关（`ai-approval-meta`、`conn-badge`、`props-toggle-track`）——胶囊是有意的次级语言               | 保留           |

## 修复（CSS 统一，layout.css / model.css）

1. `.tab` 基类：`border-radius: var(--r-sm) var(--r-sm) 0 0` → `var(--r-sm)`（全圆角），显式 `font-size: 11px`；
2. `.palette-library-tab`：padding `2px 10px` → `4px 10px`（与面板 tab 一致）；
3. `.search-box`：`999px` → `var(--r-sm)`（与主圆角语言一致）。

统一后三处 tab（Palette 库条 / 底部 / 右侧）实测：`border-radius 6px`、`padding 4px 10px`、`font-size 11px` 完全一致。

## 验证记录（本轮实际运行）

| 门禁                | 结果                                                      |
| ------------------- | --------------------------------------------------------- |
| 浏览器 computed 样式复核 | 三处 tab 与搜索框完全一致（6px/4px 10px/11px；搜索 6px） |
| `pnpm desktop:stage` + `desktop:test-staged` | PASS；78 文件（体验服务器已用新外观重启） |
| `pnpm lint:ci` / `format:check` | PASS                                        |
| `paradigm-lifecycle` 门禁 | PASS                                                  |

未跑：全量 pnpm test（CSS-only 改动，IDE 套件 389/1skip 已在上一轮核实）、MSVC。

## 未改但如实说明

- AI 面板部分按钮无 class（下拉模式行），属组件内联实现而非全局样式问题，本轮未动；
- 图标按钮尺寸（17px 操控类 vs 27px 发送行）为不同语义容器，未强行统一；
- Palette 双轨（运行时贡献 vs 结构化 CreateAction）与逻辑层职责划分不在本视觉切片范围。
