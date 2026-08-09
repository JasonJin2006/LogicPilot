# 桌面客户端

LogicPilot Desktop 是内置 Web IDE、Node 应用服务和 C++ 仿真网关的 Windows
客户端。安装包是自包含的：日常使用不要求另外安装 Node.js、pnpm、CMake 或
vcpkg。

## 安装与启动

1. 运行 `LogicPilot_<version>_x64-setup.exe`。
2. 从开始菜单启动 **LogicPilot**。
3. 使用 **File > New Project...** 创建工程，或通过 **File > Open...** 打开
   `*.lpproj`、旧版 `*.lp` / `*.json` 模型。

客户端启动时会自动选择空闲的本地端口并拉起仿真网关。底部状态栏的圆点显示
连接状态；桌面模式通常不需要手动配置 WebSocket 地址。

> LogicPilot 当前不会在启动时自动恢复上一次工程。请使用 **Open Recent** 或
> **Open...** 继续工作，并在退出前保存。

## AI 助手

右侧 **AI** 面板是一条连续对话，而不是三个互不相关的表单。它会读取当前模型、
选中对象、编译诊断和最近一次仿真指标，并按需要调用建模、编译、运行和分析工具。

- 直接描述修改，例如“在 Queue 后增加一个 Delay，并把服务台容量改为 2”。
- 询问运行结果，例如“瓶颈在哪里，为什么等待时间这么长？”
- 要求运行或优化，例如“运行 10 次复制并比较扩容前后的 Wq”。
- 执行过程中会显示计划和工具步骤；右下角停止按钮会取消当前请求。
- AI 修改可以在该轮回复中查看并撤销。若你随后手动编辑过模型，为保护手工修改，
  旧的 AI 撤销会被禁用。

在线模型需要在启动客户端前设置 OpenAI 兼容配置：

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_BASE_URL="https://.../v1"  # 可选
$env:OPENAI_MODEL="..."                # 可选
```

密钥只由本地 Node 服务读取，不会写入工程文件。没有配置密钥时，助手会回退到
内置的确定性快速操作；完整说明见 [AI Copilot](./ai-copilot)。

## 关闭与故障恢复

右上角关闭按钮会立即关闭窗口，并在后台终止本地 Node 服务与仿真网关。若客户端
异常退出后无法再次启动，可在任务管理器中结束遗留的 `logicpilot-desktop`、
`node` 或 `lp-server` 进程后重试。

## 开发者：重建安装包

在仓库根目录执行：

```powershell
# 自动加载 MSVC/Windows SDK，干净构建 Release 内核并运行测试
.\scripts\windows-build.ps1 -Preset windows-msvc-release -Clean -Test

# 构建前端、制作并验证自包含运行时、生成 NSIS 安装包
pnpm desktop:bundle
```

安装包输出到：

```text
desktop/src-tauri/target/release/bundle/nsis/
```

不要在普通 PowerShell 中直接调用裸 `cmake --build`：标准脚本会加载正确的
MSVC 标准库和 Windows SDK `INCLUDE` / `LIB` 环境，并复用仓库配置的 vcpkg。
