# 2026-09-04 审查问题修复

本记录承接异步 supervisor、请求取消、Artifact Store、Node 生命周期和 Worker service 切片，记录独立审查后完成的修复。

## 已修复

- `scripts/ai-build.mjs` 将同一个 `AbortSignal` 传给 compile、run 和受控子进程；`execution-endpoint.mjs` 对预取消请求在执行前返回 499，并在持久化前再次检查取消状态。
- `CapabilityBroker` 续期写回前确认 session 仍是当前对象，撤销中的在途调用不能复活身份。
- Worker ESM 执行 timeout 与激活 timeout 分离：有 wall budget 时使用请求预算加清场 margin，无预算时保留开发 timeout。
- refresh 使用候选 generation；候选服务表独立重建，失败恢复旧 sessions/服务表，成功后才切换并撤销旧代。
- owner-token 锁通过 rename 到唯一 quarantine 文件完成 stale-lock 抢占；活动 mutex 下恢复逻辑不触碰 `.bak`/临时文件，target 已存在时不删除备份。
- outbox 的 `complete`/`fail` 只接受持有匹配 lease token 的 processing 条目；digest 只包含业务字段。
- 修复异步 `runModelDsl` 测试遗漏 `await`，并补充 session 撤销与 service refresh 回归测试。

## 验证

- plugin-host：89/89；plugin-catalog：66/66；artifact-store：18/18。
- execution-boundary、AI build、typecheck、lint:ci（0 warnings）均通过。
- `scripts/test-node-runtime-e2e.mjs`：真实 Process package → lockfile → catalog → Worker → kernel vertical slice PASS。

## 仍未完成

- refresh 已阻止新执行并等待已接纳请求排空；排空期间的新请求会快速失败，不提供排队策略。
- Tauri app-server 已加入 Windows `KILL_ON_JOB_CLOSE` Job，lp-server/lpcli 后代继承该 Job；若 Job 分配失败仍退回 taskkill。POSIX 进程组路径仍未在 Windows 实机验证。
- Windows 目录 fsync 持久性仍未实现。
- Worker service 名称和方法已进入 manifest/schema 并由运行时校验；非 isolate 路径仍不支持跨 Worker `callService`。桌面 Rust 和 Node component entrypoint 已接入 WIT/Wasmtime sidecar；legacy raw-WASM entrypoint 保持 ABI v1 兼容路径。
