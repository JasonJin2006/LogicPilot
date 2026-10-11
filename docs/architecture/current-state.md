# 当前架构与能力边界

核对日期：2026-09-04。此页描述当前工作树，具体本轮验证见
[整理报告](../maintenance/2026-09-04-cleanup.md)、
[kernel service 异步 supervisor 记录](../maintenance/2026-09-04-kernel-async-supervisor.md)、
[请求路径全异步化与执行预算上限](../maintenance/2026-09-04-request-path-async-and-budget.md)、
[执行取消与 service.call 截止时间修复](../maintenance/2026-09-04-cancellation-and-service-deadline.md)、
[Artifact Store/outbox 原子性收口](../maintenance/2026-09-04-artifact-store-atomicity.md)、
[Node refresh/session 生命周期收口](../maintenance/2026-09-04-node-lifecycle.md)、
[Worker service 协议](../maintenance/2026-09-04-worker-service-protocol.md)
与[组件链修复与 patch-only revision 重建](../maintenance/2026-09-04-component-chain-and-patch-replay.md)、
[范式生命周期门禁](../maintenance/2026-09-04-paradigm-lifecycle-gate.md) 与
[插件卸载 HTTP 端点](../maintenance/2026-09-04-plugin-uninstall-endpoint.md)。
目标设计见 [下一代平台计划](next-generation-plugin-platform.md)，不能把该计划的验收清单当作已经完成。

## 平台关系

LogicPilot 是统一平台上的多范式系统。共享 DSL 编译、FlatBuffers IR、MethodRegistry、
SimulationKernel、Artifact Graph 和插件协议；各范式提供自己的语义和执行适配。
共享 `lpcli` 不是范式割裂，也不需要复制四个编译器。

当前同时存在浏览器 Builtin host 和 NodePluginRuntime。
浏览器侧 manifest 仍由 `web/apps/ide/src/plugins/host.ts` 的系统表装配，激活代码按需加载；
这不等于完成了所有 UI 范式的独立安装/卸载。Node runtime 包已走 catalog、锁文件、Worker。

## 目录与权威来源

| 部分             | 位置                                                      | 边界                                                              |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| 壳层与编辑器     | `web/apps/ide/src/`                                       | 仍有 Process/SysML store、面板及 Palette 耦合                     |
| 中性插件协议     | `web/packages/plugin-host/`                               | 生命周期、依赖、权限、注册表，不依赖文件系统                      |
| Node 包与 loader | `web/packages/plugin-catalog/`                            | 扫描、digest、PackageStore、Worker、runtime generation            |
| 持久化           | `web/packages/artifact-store/`                            | Artifact/Revision/Transaction、durable outbox、token 锁与原子替换 |
| runtime 包源码   | `plugins/runtime/`                                        | 单方法与 generic mixed-method manifests + 一个 entrypoint 模板    |
| runtime 包构建   | `scripts/build-runtime-plugins.mjs`                       | 生成自包含包目录；仅批准明确的系统权限                            |
| 执行策略与证据   | `scripts/runtime-adapters.mjs`、`runtime-conformance.mjs` | 方法策略、replay、结构化校验                                      |
| DSL/IR 执行      | `scripts/ai-build.mjs`、`kernel/apps/lpcli/`              | compile → IR method preflight → run                               |
| HTTP/WS 执行     | `web/apps/ide/scripts/execution-endpoint.mjs`、`app/execution-websocket.mjs` | 统一查询/创建/控制当前 Node runtime；空注册表无静态 fallback |
| 执行归档         | `web/apps/ide/scripts/execution-artifacts.mjs`            | pin 读取、run/evidence outbox、引用与幂等                         |
| 契约源           | `schemas/contracts/`                                      | 唯一源，生成 TS/C++；baseline 显式演进                            |

## 已具备的执行路径

1. 系统发布构建把 `plugins/runtime/entrypoint.mjs` 复制进四个单方法包和一个 generic mixed-method 包，计算 manifest-bound digest 并写 lockfile。
2. NodePluginRuntime 根据 catalog + lockfile + trust 激活 Worker。manifest 声明 execution targets。
3. 请求经 `/api/execution/targets`、`/api/execution/runs`（创建或列出）、
   `/api/execution/runs/:id` 和 `/api/execution/runs/:id/commands` 到
   ExecutionTargetRegistry，再经 CapabilityBroker 调用 kernel service。
   旧 `/api/execution` 仅是迁移期委托包装；事件订阅使用同源 `/api/execution/events` WebSocket，
   控制命令不走 WebSocket。
   系统包同时提供四个单方法 target 和 `logicpilot.generic.runtime`；后者的 evidence 使用
   `methods` 列表承载混合 IR 方法，不伪装成 Process/Agent 等单一 runtimeKind。
   `scripts/test-node-runtime-e2e.mjs` 已验证 runtime package → lockfile → catalog → Worker → kernel 的真实 vertical slice。
4. `lpcli compile --methods-json` 输出实际 IR 方法。指定 runtime 的请求必须在 run 之前匹配唯一方法：Process→process、DEVS→devs、Continuous→sd、Agent→agent。
5. 未指定专属 runtime 的通用 AI runner 可运行内核支持的混合方法模型。专属 target 目前拒绝混合 IR，不能用“包含某个方法”放行全部方法。
6. Evidence 包含 IR digest、method、检查与指标摘要。entrypoint 的 evidence digest 覆盖去掉 digest 字段后的完整 canonical evidence。
7. kernel service、`/api/ai-run`、`/api/ai-build`、`/api/ai-validate`、`/api/ai-optimize`、
   `/api/ai-explain` 的子进程执行全部经 `scripts/subprocess-supervisor.mjs` 异步运行：
   `maxWallMs` 预算到点后回收整个进程树（Windows 用 `taskkill /T /F`，POSIX 用进程组 SIGKILL），
   stdout/stderr 有上限，settle 后移除全部监听；compile/run/replay 共享同一 deadline 和 signal；
   `optimize.mjs`/`ai-optimize.mjs`/`ai-explain.mjs` 复用 `ai-build.mjs` 导出的 `runLpcliAsync`。
   请求路径不再存在 `execFileSync`。
8. 执行取消：请求策略为每个请求挂 `REQUEST_CANCEL_SIGNAL`（AbortSignal，超时/并发拒绝时触发）；
   兼容 `/api/execution` 的同步调用在客户端断开（响应未完成）或策略信号 abort 时按 requestId 调用
   `cancelKernelRun`，桥接层 `AbortController` 经 `runRuntimeModel`→`runModelDsl`→supervisor
   中止对应执行并回收进程树；预取消请求在执行前返回 499，运行时适配器对预取消返回 RT0005。取消是协作式的：已开始的子进程由 supervisor 杀掉，尚未开始的调用直接失败。
9. 执行创建路由有服务端预算上限 `MAX_EXECUTION_WALL_MS`（10 分钟）：未传 `budget` 的请求获得该默认值，
   超过上限的 `budget.maxWallMs` 在任何内核副作用之前以 400 拒绝。
10. worker 侧 RPC 截止时间：`runtime.service.call` 的 broker deadline 按请求的
    `budget.maxWallMs + 30s` 计算（`serviceCallDeadlineMs`），不再被 10 秒激活超时截断；
    普通 capability 请求仍用激活超时。
11. 服务 RPC 的拒绝（如 runtime owner 不匹配）现在以 CapabilityDeniedError 回传显式 code
    （`runtime-not-owned`）并进入 host audit 日志的 deny 事件；Worker 侧 execute/activate 失败也携带根因，
    不再被包装成无信息的 `isolated ESM execution failed`。

部署注意：staged smoke 显式配置 Node plugins、系统 roots、store、T4。仅执行 `pnpm desktop:stage`
会生成包与锁文件；桌面启动器/用户安装后的默认配置仍需完整验收。Node host 仍是 opt-in。
`/api/ai-run` 保留其 AI 结果响应格式；传入明确 `runtimeKind`（process/devs/
continuous/agent）时已通过当前 ExecutionService 和对应插件 target 执行，并返回
`execution.run/evidence`。未指定范式的 generic/mixed AI run 仍是兼容 runner，不能把它
误称为已迁移到插件执行链路。

## 证据的实际含义

- `conformance` 当前检查结果结构、有限数值、轨迹时间顺序以及可选 replay；所有要求必须通过才标记 passed。
- 不根据变量名 `arrival_rate`/`service_rate` 就假定模型是 M/M/1；不根据 `y`/`k` 就假定 ODE 为指数衰减。旧的通用理论猜测已移除。
- MM1/Decay 的理论断言只属于明确的参考案例。通用 Process/ODE 理论误差阈值、适用条件与知识来源仍待建立。
- Agent 单 replication 可导出 LPLT logical trace 摘要。多 replication 会保留调用者的参数，不能为拿到 trace 而偷偷改成 1 次。
- DEVS 的 LPLT 可能只有 24 字节空头，不能证明 internal transitions。DEVS transition archive 尚未在该 HTTP 链路导出，证据明确记为 `transition-trace-not-exported`。
- replay 是重新运行时的指标/轨迹/trace 一致性检查，不是 checkpoint restore 测试；它复用第一次的实际 seed/count。
- 当前只持久化 run/evidence JSON 摘要；临时二进制 trace/完整 trajectory 文件仍会清除。digest 不代表文件可下载。
- IR digest 绑定本次 IR 字节；编译源路径元数据可能令相同 DSL 在不同临时目录生成不同 digest，不能把它直接当跨编译内容地址。

## 尚未完成的边界

- 子进程回收发生在超时/中止时；Tauri 壳将 app-server 放入 Windows `KILL_ON_JOB_CLOSE` Job，
  其 lp-server/lpcli 后代继承该 Job，壳强杀时由 Windows 兜底回收。若 Job 分配失败则退回 taskkill 路径；
  POSIX 进程组 SIGKILL 分支未在 Windows 实机验证。
- 执行预算有服务端默认与上限（10 分钟），但 `maxSteps` 的语义与 `/api/ai-run`（无预算概念）未统一；
  除 `/api/execution` 外的 AI 端点没有服务端执行时长约束。
- T4 Node Worker 提供故障隔离，不是文件系统/网络沙箱；插件可导入 Node builtin。WASM 内存目前不是硬 quota；桌面 Rust 与 Node component entrypoint 均使用 Wasmtime Component Model sidecar/WIT world，legacy `wasm` entrypoint 仍使用兼容的 raw ABI v1。
- Node runtime 的 session 有可配 TTL 与滑动续期（成功 capability 调用把过期时间前移，撤销中的在途调用不会复活），失败 refresh 会回滚到旧代 sessions，
  因此“保留旧 host”时其能力仍可用；直接对返回的 PluginHost 调 stop 不等于 PackageManager 卸载整个 generation
  （stop 不动 lockfile/包，start 会按 lockfile 重新激活）。refresh 运行中会先阻止新请求并等待已接纳执行排空；
  卸载有 HTTP 端点（POST /api/plugins `{action:"uninstall"}`：`PackageManager.uninstall` + 立即 refresh 换代，
  错误码 404/409/400 明确，有端到端验收）——只作用于 Node runtime 的 lockfile 插件，
  浏览器 builtin 范式仍只有 `host.stop` 编程缝隙。
- Worker service 协议已落地：`runtime.service.provide` 不再静默成功（请求/响应 + 注册表 + 审计拒绝），
  `runtime.service.call` 支持按方法分发、方法白名单（`method-not-allowed`）、跨 worker 路由（`callService`）
  与 generation 撤销时的 dispose；服务名/方法已在 manifest 的 `services` 契约中声明并由运行时校验，
  非 isolate 路径未提供 `callService`、提供可调用服务需 `runtime.service.provide` 授权。
- 有 pin 的执行支持 patch-only revision：服务端沿 `parentRevisionId` 回溯最近带 document 的 `model-save`，
  依序重放 `model-patch`（不可应用则以诊断 409 拒绝），`generateDsl` 产出执行源（editor 以单文件 esbuild
  bundle 进 staged 运行时）。限制：只重放线性链、只有 dsl 无 document 的旧快照之上的 patch 无法重建。
  无 pin 的 scratch 执行仍允许，并明确为未版本绑定。
- UI 建模闭环有端到端验收：编辑器 Save（model-save 含 document+dsl）→ AI patch 本地 apply 并提交
  patch-only revision → pin 执行收到服务端重放后的 DSL（`modelingLoop.test.ts`，真实客户端 + 真实 HTTP
  handler + 真实落盘 store 整链）。
- Artifact Store/outbox 已用 owner-token 互斥锁（活 pid 不偷锁、stale 回收以 quarantine rename 抢占、过期 lease 由下次 claim 恢复、短临界区有界自旋）、
  `.bak` 备份/恢复的原子替换与 claim lease；store 构造时会恢复 state/snapshot，目录 fsync 在 Windows 无法保证 OS 掉电持久
  （文件级 fsync 已做）、并发调用方需对 `being written by another process` 做重试，而非把瞬态冲突当 500。
- Shell 范式表面遵循插件生命周期：`paradigm-lifecycle` 浏览器门禁（`pnpm test:paradigm-lifecycle`）验证了
  全范式基线、运行时 `PluginHost.stop('logicpilot.sysml')` 只撤销该范式的 document/palette/panel
  （process/DES 不受影响）、以单 builtin 重启宿主后贡献集精确跟随发现表（宿主级卸载语义）。
  Palette 按活动文档类型过滤已落地（PaletteContribution.context + 面板空态；paradigm-lifecycle 门禁断言 .lp/.sysml/纯文本三态）；新建工程画布默认进入 DSL 上下文。仍缺：旧运行时 contribution 与结构化 CreateAction 双轨的完整合并（结构化条目需契约级 documentTypes 标签）、SysML/C4 规则与共用画布的端到端验收、按插件的浏览器卸载 UI。
- 知识包的公式 AST、专家出处、诊断全覆盖、论文摄取、AI 修改插件的完整审批链尚未完整验收。

下一位开发者应以这些缺口和交接报告安排工作，避免继续新增没有真实行为的 facade 或空测试。
