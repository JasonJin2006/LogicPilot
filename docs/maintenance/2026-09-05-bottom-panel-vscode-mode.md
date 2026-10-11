# 2026-09-05 底栏对齐 VS Code 面板模式

起因：用户希望底栏（Problems / Console）学 VS Code 的面板模式。

## 做了

| 项         | 内容                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 视图图标   | `PanelDef` 新增 `icon?: ComponentType<{size?:number}>`（语言贡献注册面板时同样可用）；Problems → `CircleAlert`、Console → `ScrollText`，tear 栏渲染图标 |
| 问题徽标   | `ProblemsPanel` 导出 `useProblemCount()`（订阅模型文档 + 全部贡献 problem source）；底栏 Problems tab 在问题数 >0 时显示计数徽标（>99 显示 99+），0 时隐藏——VS Code 行为 |
| 单视图独占 | 现有 layout 已满足（`panel-pane.active` 单视图），保持                                                                  |
| 样式       | `layout.css` 新增 `.tab-icon`（活动 tab 着色）与 `.tab-badge`（accent 小胶囊）                             |

## 验证记录（本轮实际运行）

| 门禁                       | 结果                                                      |
| -------------------------- | --------------------------------------------------------- |
| 浏览器复核                 | 底栏 Problems/Console 带图标、单视图、0 问题无徽标 ✓（全屏截图） |
| `tsc`（IDE） / IDE 套件    | PASS；389 passed / 1 skipped                             |
| `lint:ci` / `format:check` | PASS                                                      |
| `desktop:stage` + `test-staged` | PASS；78 文件（体验服务器已用新构建重启，http://127.0.0.1:62721） |

## 后续可做（VS Code 完整面板行为，等用户诉求）

- tab 拖拽排序/加号“其他视图”菜单；
- Console 事件徽标（unread 计数）与清除按钮；
- 面板最大化（双击标题栏）/ 位置拖到左右侧。
