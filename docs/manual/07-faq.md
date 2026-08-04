# FAQ / 排错

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

确认使用相同 `--seed` 与相同构建产物；连续模型额外确认 `--arrivals`（步数）一致。跨工具链（MSVC/clang）不承诺逐位一致，见 [确定性复现](./06-determinism)。

## 浏览器看不到动画？

- 确认 `lp-server`/`lpcli serve` 在运行且端口一致
- 点击 **Connect** 且状态变为绿色
- 服务端 `--trace` 可把每帧以 JSON 镜像到 stdout 排查
