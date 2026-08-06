# LogicPilot VSCode Extension

LogicPilot DSL 的 VSCode 扩展（P2）：语法高亮 + 基于 `lp-lsp` 语言服务器的
诊断 / 补全 / 悬停。

## 运行前提

构建语言服务器：

```powershell
cmake --build build/windows-msvc-dev --target lp-lsp
```

产物：`build/<cfg>/dsl/lp-lsp(.exe)`。扩展按 `$LP_LSP` → `build/*/dsl/lp-lsp`
→ PATH 的顺序查找。

## 调试运行

在 VSCode 中打开本目录（`extensions/logicpilot-vscode`），按 `F5`（Extension
Development Host），打开任意 `.lp` / `.lplib` 文件即可看到诊断与补全。

## 结构

- `extension.js`：自包含 LSP 客户端（stdio JSON-RPC，无 npm 依赖）。
- `syntaxes/logicpilot.tmLanguage.json`：TextMate 语法（与在线手册 Shiki
  语法同源）。
- `language-configuration.json`：注释 / 括号 / 自动闭合。

## 手动打包

```powershell
npx @vscode/vsce package
```
