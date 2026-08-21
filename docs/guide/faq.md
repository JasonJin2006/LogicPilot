# FAQ / 排错

## Windows 编译提示找不到 `<memory>`、`<cstdint>` 或 Windows SDK

这通常不是代码错误，而是普通 PowerShell 没有加载 Visual Studio 开发环境。请从
仓库根目录使用标准入口：

```powershell
.\scripts\windows-build.ps1 -Preset windows-msvc-dev -Test
```

脚本会自动发现 Visual Studio、执行 `vcvars64.bat`、校验 MSVC 标准库和 Windows
SDK 的 `INCLUDE` / `LIB`，并定位 vcpkg。Release 构建把 preset 改为
`windows-msvc-release`；完全重建增加 `-Clean`。不要把某次开发者终端里的
`INCLUDE` / `LIB` 永久复制到系统环境变量。

## AI 助手提示没有 API Key

优先打开 **Settings → AI provider** 选择服务商、协议与模型。可以使用云端 API、本地 Ollama / LM Studio / vLLM，或复用 Codex 登录；API Key 只在当前本地后端进程中保存。环境变量方式仍受支持，适合自动化启动。

在线助手需要在启动 Vite 或桌面客户端的同一个环境中设置：

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_BASE_URL="https://.../v1"  # 可选
$env:OPENAI_MODEL="..."                # 可选
```

未配置时 IDE 会回退到内置快速操作。不要把密钥写入仓库或工程文件；仓库已忽略
`.env` 和 `.env.local`。

## 本地 API 是否可以部署到服务器？

不能直接部署。`app/server.mjs` 只绑定 `127.0.0.1`，面向桌面端和本地开发，
不提供用户认证、项目权限、请求限流或多用户任务隔离。它还允许用户配置本地
MCP 命令和自定义 AI endpoint，因此应视为本机可信控制面。若要远程部署，必须
另加认证、CSRF/origin 校验、限流、SSRF 防护、MCP 沙箱和审计日志。

## 运行编译产物提示"找不到 DLL"（0xc0000135）

`build/integration-dev` 是 MinGW 动态构建，运行前把运行时目录加入 `PATH`：

```powershell
$env:Path = "$PWD\build\integration-dev\vcpkg_installed\x64-mingw-dynamic\debug\bin;" +
           "C:\msys64\ucrt64\bin;" + $env:Path
```

MSVC 预设（`windows-msvc-dev`）则需要在 MSVC 开发环境下运行（`vcvars64.bat`）。

## 端口被占用

```powershell
Get-NetTCPConnection -LocalPort 8089 -State Listen | Stop-Process -Id { $_.OwningProcess } -Force
```

或换端口：`lpcli serve examples/mm1.lp --port 8090`（IDE 连接地址相应改成 `ws://127.0.0.1:8090/sim`）。

## 编译报错与诊断

```powershell
lpcli compile examples/bad.lp --diagnostics-json diag.json
Get-Content diag.json    # ok / diagnostics[]，含 code、severity、message、span
```

常见错误码：`LP2001` 缺必填字段、`LP2003` 超出结构约束（如多个 on_input）、`LP5001` 效果目标未声明、`LP5002/5003` 布线端口无效。完整代码表见 [DSL 规范](/specs/dsl-spec)。

## `pnpm install` 报 supply-chain 策略错误

环境 pnpm 版本与 `packageManager`（pnpm@9.15.0）不一致时会触发自动重装校验；用仓库固定版本：

```powershell
corepack pnpm install
```

## 两次运行结果不一样？

确认使用相同 `--seed` 与相同构建产物；连续模型额外确认 `--arrivals`（步数）一致。跨工具链（MSVC/clang）不承诺逐位一致，见 [确定性复现](./determinism)。

## 浏览器看不到动画？

- 确认 `lp-server`/`lpcli serve` 在运行且端口一致
- 点击 **Connect** 且状态变为绿色
- 服务端 `--trace` 可把每帧以 JSON 镜像到 stdout 排查
