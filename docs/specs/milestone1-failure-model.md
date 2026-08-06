# 里程碑 1 契约：多服务器与机器故障（M/M/c + breakdowns）

状态: Implemented（2026-08-04；全量 ctest 现为 212）。内核引擎（QueueingFlowSim M/M/c + breakdowns）、
IR 接线（ir_loader）、验收模型（examples/mm1_failure.lp + expect.json）与流式驱动
（SimRunner/lp-server 现已按 IR 模型参数运行，含多服务器与故障，wire Counters 增加
`servers` / `down_servers` 字段）均已落地。

## 目标

让 DSL 中已经存在的 `resource { capacity, failure_rate }` 在运行时**真实生效**：

1. `capacity > 1` → 多服务器队列（M/M/c），不再被当作单服务器。
2. `failure_rate > 0` → 服务器在忙时按指数故障率失效、按修复率修复（v0 修复率固定默认 `1.0`，IR 预留 `repair_rate` 参数）。

不需要修改 `schemas/`（F1/F2 冻结）：故障参数通过现有 IR `Param` 机制传递。

## 契约（参数名与语义，跨组冻结）

- IR 中资源 = CoupledModel 子节点 `AtomicModel`，`params` 携带：
  - `capacity`（IntValue，≥ 1）
  - `failure_rate`（FloatValue，∈ [0, 1]；0 = 永不故障）
  - `repair_rate`（FloatValue，**可选**；v0 运行时缺省 = 1.0）
- `ServiceNode.servers` = 对应资源的 `capacity`（DSL lowering 已实现）；运行时必须读取并生效。
- 故障语义（v1，preemptive-repeat）：
  - 服务器开始服务某顾客时，绘制 `service_time`，再绘制 `failure_time ~ Exp(failure_rate)`（f=0 时不绘制/不故障）。
  - 若 `failure_time < service_time`：到点后**该顾客回到队列头部**（服务作废、重新排队），服务器进入 down 状态，绘制 `repair_time ~ Exp(repair_rate)` 并调度修复完成。
  - 修复完成后服务器可再次接单（取队首）。
  - 服务器 down 期间不服务；排队与到达照常。
- 统计口径不变：`ReplicationMetrics`（L/Lq/W/Wq/throughput），顾客等待/滞留时间以 `arrival_ns` 记账，被抢占者天然计入。
- 确定性：固定种子 → 同一 RNG 绘制顺序 → 逐位复现（沿用 `TraceRecorder` 哈希验收）。

## 验收

- 新增 `examples/mm1_failure.lp`（如 `lambda=0.8, mu=1.0, capacity=1, failure_rate=0.1, repair 默认 1.0`），
  有效性可用度 `a = r/(f+r)`，有效服务率 `mu_eff = a*mu`，按 M/M/1 公式给出 `Wq/W/Lq/L/throughput` 理论值，
  写入 `examples/mm1_failure.expect.json`（容差从宽，如 ±20%，机制同 mm1.expect.json）。
- 新增内核测试：
  - 多服务器：`capacity=2, lambda < 2*mu` 时利用率/队长显著优于 M/M/1（或对拍 Erlang-C 理论值）；
  - 故障：`failure_rate=0` 与 M/M/1 完全一致；`failure_rate>0` 时吞吐下降、Wq 上升，且在理论容差内；
  - 确定性：同种子两次运行逐位一致（复用现有 determinism 测试模式）。
- 既有 88 个 ctest 全部保持通过（`mm1.lp` 无故障、单服务器，行为不变）。
