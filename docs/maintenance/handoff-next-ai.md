# 下一个 AI 的开发交接提示词

以下正文可以直接作为新任务提示词使用。

---

你正在接手 LogicPilot，Windows 仓库为 `C:\Users\JasonJin06\Desktop\LogicPilot`。
任务是继续统一插件平台开发，同时维护当前产品行为。用户允许必要的破坏性架构调整和丢弃旧实现，
但不要把代码移到另一个文件就称为解耦，也不要增加空 provider、同义 facade 或只检查数组非空的“验收”。

## 开始前必须核对

1. 读根 `AGENTS.md`、`docs/README.md`、`docs/architecture/current-state.md`、
   `docs/maintenance/2026-09-04-cleanup.md`、`docs/maintenance/2026-09-04-kernel-async-supervisor.md`，
   然后看 `git status --short`、`git diff --stat`。
2. 交接时可能仍有未提交改动，覆盖前几轮 runtime 开发和此次整理。保留它们；禁止 reset/checkout 覆盖。
   报告中的起点 HEAD 是 `debbac2`，不是说工作树只有该提交的内容。
3. 原平台目标在 `docs/architecture/next-generation-plugin-platform.md`。它是目标计划，不是完整实现证明。
   旧对话中的“全完成/全绿”有过高估；以当前源码、报告中的实跑命令与结果为准。
4. 不要重复询问是否继续做已授权的开发。独立完成一个真实可验收的切片，写清剩余边界。

## 产品与架构意图

系统应是统一核心 + 可组合范式/垂类知识/视图/运行时插件。Shell、权限、事务、Artifact Graph 和
协议是共享核心；SysML、C4、Process、Agent、DEVS、Continuous、Statechart 有各自规则。
Palette 归画布宿主、由 View/Notation/Selection/Permission 决定，不是每个范式另做一个全局 palette。
AI 应按需使用结构化知识、诊断与 fix；在授权下只能修改 draft，经过校验审批才能安装，不能自行提升权限。
这里的 Agent 仿真范式与 AI AgentEngine/Harness 是不同概念。M/M/1 只是排队论参考案例。

## 已落地链路和代码地图

- `schemas/contracts/` 是 JSON Schema 源；`node scripts/gen-contracts.mjs` 生成 TS/C++。
  不手改生成物。只在有明确协议决策时更新相应 baseline；ADR-0135 记录了 Palette canvas 的变更。
- `web/packages/plugin-host/`：中性 host、CapabilityBroker、ExecutionTargetRegistry。
  head target 可接受 request pin；返回 run 必须匹配 requestId/targetId/pin/seed。
- `web/packages/plugin-catalog/`：扫描、manifest+payload digest、PackageStore、NodePluginRuntime、Worker loader。
  manifest.executionTargets 绑定模块 execute；target owner 冒用会被拒绝。session 有可配 `sessionTtlMs` 和
  broker 的滑动续期；refresh 失败会恢复 `previousSessions`（保留旧 host 的能力），成功则撤销旧代。
  worker service 协议：`ctx.provide(name, service)` 走校验式注册（请求/响应，非静默），`ctx.service(name)`
  返回按方法分发的代理（`{name, method, args}`），host 在 `serviceRegistry` 记录 owner/方法白名单/路由模块，
  `callService` 把跨 worker 调用路由回提供者；generation 撤销时 dispose。
- `web/packages/artifact-store/`：Artifact/Revision/Transaction、durable outbox、执行归档。
  写路径用 `atomic-file.ts`（`.bak` 备份/恢复的原子替换 + fsync）与 `lock.ts`（owner-token 互斥，活 pid
  不偷锁、stale 且闲置才回收、短临界区有界自旋）；outbox 的 claim 带 lease（leaseOwner/token/expiresAt，
  过期或 owner 死亡才被下次 claim 恢复）。改 src 后必须重建 `artifact-store` 与 `plugin-catalog`（生产走 bundle）。
- `plugins/runtime/`：四份 manifest + 一份 `entrypoint.mjs` 模板。
  `scripts/build-runtime-plugins.mjs` 生成自包含包；不要把模板跨目录 import 到已安装包，也不要恢复四份重复源码。
- `scripts/stage-desktop-runtime.mjs`：产物在 `build/desktop-runtime`；构建系统 runtime 包及 `plugin-store/logicpilot.lock`。
  staged test 显式设置 Node plugins/root/store/trust，不依赖静态 execution fallback。
- `/api/execution` 在 `web/apps/ide/scripts/execution-endpoint.mjs`，只查询当前 Node runtime registry。
  错误 JSON/类型/过大 body 有明确 HTTP 状态码；pin 来源读取与归档在 `execution-artifacts.mjs`。
- `scripts/runtime-adapters.mjs` 负责参数、方法与 replay 策略；`runtime-conformance.mjs` 负责真实检查。
- `scripts/subprocess-supervisor.mjs`：异步子进程 supervisor。`runModelDsl`/`runRuntimeModel`/`buildModel`/
  `validateModelDsl`（`ai-build.mjs`）全部 async；kernel service 与 `/api/ai-run`、`/api/ai-build`、
  `/api/ai-validate`、`/api/ai-optimize`、`/api/ai-explain` 都走这条链（`optimize.mjs`/`ai-explain.mjs`/
  `ai-optimize.mjs` 复用 `ai-build.mjs` 导出的 `runLpcliAsync`/`prepareLpcli`）。预算 `budget.maxWallMs`
  到点回收进程树，compile/run/replay 共享 deadline；`/api/execution` 的预算缺省为 10 分钟并在超限时 400。
  新模块必须加进 `scripts/stage-desktop-runtime.mjs` 的 requiredFiles，否则 staged server import 失败。
- 执行取消：`app/request-policy.mjs` 在 req 上挂 `REQUEST_CANCEL_SIGNAL`（超时/并发拒绝即 abort）；
  `/api/execution` 在客户端断开或策略 abort 时经 `cancelKernelRun(requestId)`（plugin-catalog-bridge 的
  注册表，按 requestId 存 `AbortController` 集合）传到 `runModelDsl`→supervisor 中止执行；
  entrypoint 的 `kernel.call` 必须携带 `requestId`。
- `runtime.service.call` 的 broker deadline 由 `serviceCallDeadlineMs` 按 `budget.maxWallMs + 30s` 计算
  （node-runtime.ts），普通 capability 请求仍用 `activationTimeoutMs`（默认 10s）。不要把这个 10s 误解为执行时长上限。
- `scripts/ai-build.mjs` 调用 `lpcli compile --methods-json`，在 run 之前核对 actual IR method。
  Process→process，DEVS→devs，Continuous→sd，Agent→agent。通用 AI 调用不指定 runtime，可走内核混合方法。
- `kernel/apps/lpcli/compile_command.cpp` 输出 method summary；C++ MethodRegistry/SimulationKernel 已有真实方法实现，
  无需为四类方法复制四套 CLI。底层共用 lpcli 不等于未接入内核，也不等于 UI 已完全插件化。

## 易错点：不要回退这些修复

- 不可在运行后才检查 IR，不能只用 `methods.includes` 放行带额外方法的混合模型。
- `seed` 必须进入实际运行参数，不能仅抄到结果里；replay 要冻结首次实际 seed 和 replication 数。
- 不得为了 trace 自动把用户的 reps 改成 1；Agent 多 replication 暂不导出单次 LPLT。
- `conformance.passed` 必须由检查结果得出，不能出现 checks=false 但 passed=true。
- 不可按变量名猜 M/M/1 或指数衰减的科学前提；理论阈值只能用于明确标注且验证适用条件的参考案例。
- DEVS 的 24-byte LPLT 头不证明 transition trace。当前明确 `transition-trace-not-exported`。
- trace digest 仅是临时输出摘要，二进制 trace/trajectory 尚未持久化、不可声称可下载或可 checkpoint 恢复。
- IR 中源路径可能影响二进制 digest，不能用跨临时目录的 IR digest 相等作为 replay 必要条件。
- Browser composition generation 与 remote SSE replay cursor 不同；签名只能覆盖原签名载荷。
- 不要用对象 spread 拷贝有 prototype 方法的 provider；需保留 this 绑定。
- 不要缓存 fallback registry；卸载/停止后不得让旧 target 静默继续工作。
- `ExecutionEvidence.details.summary`/conformance checks 当前仍是 JsonValue，并非严格的四种 discriminated union。
- 子进程只经 `scripts/subprocess-supervisor.mjs` 异步执行，不要再引入会阻塞请求路径的 `execFileSync`；
  `runModelDsl` 等已是 async，同步调用会拿到 Promise 导致下游错位。
- 能力拒绝抛 `CapabilityDeniedError`（带 denialCode）；普通 `throw new Error` 会被 broker 包装成
  `handler-failed`，worker 侧只看到失败且不进 deny 审计。
- worker 被 terminate 之后（拒绝/失败执行路径）deactivate 必须是幂等空操作、execute 必须快速失败，
  不要对死 worker postMessage 等待答复。
- staged 运行时新文件必须加进 `stage-desktop-runtime.mjs` 的 requiredFiles；staged 门禁失败先查
  是否缺少该文件，而不是改测试。
- 取消链：`kernel.call` 输入必须带 `requestId`；桥接层按 requestId 注册 controller；
  执行取消是协作式（已开始的子进程被 supervoisor 杀掉、未开始的快速 RT0005），不要假设
  `cancelKernelRun` 能阻止已提交的 `persist`。取消入口调用必须幂等、对未知 requestId 无副作用。
- `runtime.service.call` 的 broker deadline 按预算计算；若把执行时长与 `activationTimeoutMs` 混同，
  长预算执行会在 10 秒后收到超时响应而子进程仍在后台运行。
- artifact-store 的锁是 fail-fast + 有界自旋：短争用由自旋吸收，长持锁会让 acquire 返回冲突，
  调用方/背景写入（drain、persistExecutionResult）必须对 `being written by another process` 重试，
  不要把它当 500。lease 字段只属于 outbox 内部格式，不要加进 `digestInput`，否则会改变幂等键。
  改 artifact-store/src 后必须重建 artifact-store 与 plugin-catalog 的 bundle。
- session 续期只影响会话寿命，不影响在途调用的 deadline；不要用 renewable TTL 覆盖 service.call 的预算 deadline。
  refresh 失败必须恢复 `previousSessions`，否则“保留旧 host”会变成所有旧 worker 的 capability 都 `runtime session unavailable`。

## 后续优先顺序

P1：执行生命周期收尾。可取消、预算与 Tauri Windows Job Object 兜底已落地
（Job 单测已通过）；POSIX 进程组 SIGKILL 分支未在 Windows 实机触发；
`budget.maxSteps` 与 AI 端点（`/api/ai-run` 等无预算概念）的服务端约束未统一；
`persist`/归档阶段不受取消控制。

P1：补齐 Node refresh/session/service 生命周期。session TTL/续期（`sessionTtlMs` + broker `renewSession`/滑动
`renewTtlMs`）、失败 refresh 回滚旧代 sessions（不再“保留旧 host 但能力失效”）、worker service 协议
（provide 校验式注册 + 所有权/方法白名单/dispose + 跨 worker 路由 + generation 撤销清理）均已落地并有验收。
剩余：卸载无 HTTP 端点（仅 watch 轮询兜底）、非 isolate 路径未提供 `callService`。

P1：WASM 能力与 quota。T4 Node ESM Worker 不是 OS 权限沙箱；T2 WASM 后置 memory 检查不是硬内存上限。
random import 仍存在本地实现；桌面和 Node 的 `component` entrypoint 已通过 wit-bindgen/Wasmtime sidecar 接入，legacy raw-WASM loader 保留 ABI v1 兼容路径。按真实攻击/超限用例验收。

P1：Artifact 持久化收尾。原子替换/token 锁/lease 与 `snapshot()` 启动自愈已落地，剩余：
目录 fsync 在 Windows 无法保证 OS 掉电持久（文件级 fsync 已做）、并发调用方需对 `being written by
another process` 做重试而非当 500；以及 patch-only revision 重建（base model-save + 线性 model-patch 重放）。

P2：实际桌面启动配置与插件包安装 UI。staged test 设置的环境不自动代表发布版启动器已配置；
检查 Tauri 对可写用户 store、只读系统包、升级/回滚和锁文件的行为。

P2：Shell/Palette 去范式化。browser Builtin 表、model/dsl 默认面板、Process/SysML stores 和两套 Palette
仍然存在。应先用卸载/零插件/视图切换端到端测试定义边界，再移除静态依赖，不只移动路径。

P2：科学 evidence 与知识。建明确参考案例的误差阈值、出处和条件；导出真实 DEVS transition archive、
Agent checkpoint/replay、ODE solver 误差。完整 trace 持久化后再加下载/对比 UI。勿伪造 trace 完整性。

## 构建与验证纪律

Windows 原生只能使用 `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test`，更改 CMake 用
`-Configure`，首次清理可用 `-Clean -Test`。Release sidecar 用 `windows-msvc-release`。
不要从普通 PowerShell 直接调用 MSVC CMake build。Node 是 MSVC 输出规范化 launcher 的依赖。

本机曾因中文 GBK `/showIncludes` 前缀损坏导致 Ninja #deps=0，进而链接新旧结构体对象产生 SEGFAULT。
新增 `cmake/msvc-output.mjs` 统一编码和前缀。不要只看到 clean build PASS 就结束，需检查 Ninja
的 test_contracts 对象依赖确实包含 `contracts_generated.h`。禁止手工修改 build.ninja 或生成头。

常用门禁：

```powershell
pnpm -r --filter @logicpilot/plugin-catalog... build
pnpm check:contracts
pnpm test:runtime-conformance
pnpm test:execution
pnpm test:runtime-adapters
pnpm test
pnpm typecheck
pnpm lint:ci
pnpm format:check
pnpm docs:build
pnpm desktop:stage
pnpm desktop:test-staged
```

当前 `lint:ci` 已收紧到零 warnings；不要恢复为旧的 21 上限来绕过新增问题。

先完成依赖构建再跑依赖 dist/bundle 的脚本。stage 默认使用 Release sidecar；新 CLI flag 加进 dev binary
而没有更新 Release 时会失败，不能用旧产物通过测试。不要同时重建 stage 目录和运行 staged test。
保留长命令 session_id 并轮询结束，不能因输出截断就再次启动相同测试，也不能把开始日志算成 PASS。

每个切片交付应说明：改了什么、为什么、实际跑过的测试、失败与剩余边界。提交前核对 diff；
没有完整门禁就准确标注，不能重用旧会话的测试数字。最后同步当前状态页和维护报告。
