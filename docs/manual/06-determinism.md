# 确定性复现与契约

## 为什么能逐位复现

给定固定种子，同一构建的仿真**逐位可复现**，由三层机制保证：

- **确定性 RNG**：xoshiro256++ 流，种子派生只用 add/shift/rotate，无系统熵
- **确定性时间**：int64 纳秒定点时间（`t*2^32`），无浮点累积漂移
- **同刻事件排序**：时间戳相同的并发事件按 FIFO（入队顺序）tie-break

```powershell
lpcli run --model-file build/mm1.ir.bin --seed 42   # 两次运行输出逐位相同
```

> **范围说明**：bit-exact 指**同构建内**可复现。`exp/log/sqrt/sin/cos` 走 libm，跨工具链（MSVC vs clang-libc++）不保证逐位一致；跨平台黄金值对比需自研位精确实现后再引入（评审 m4）。

## 契约分层

| 契约 | 内容 | 冻结 |
|---|---|---|
| F1 | `schemas/ir_v2.fbs` 模型 IR（`LP2R`，Node/SemanticsRef） | ✅ 双门禁 |
| F2 | `schemas/wire.fbs` 遥测帧 | ✅ 双门禁 |
| F3 | C++ ↔ TS 运行时互操作 | ✅ CI 逐字段校验 |

变更纪律（ADR-0004）：`flatc --conform` + `.bfbs` SHA256 双门禁，schema 变更与 `schemas/baseline/` 更新必须在同一 commit。

## IR 契约（v2）

- `lpcli compile` 发射 **v2**（Node/SemanticsRef 薄契约 + 引擎注册表，`LP2R`）；
  v1（`LPIR`）已随全量迁移移除
- 迁移设计见 [IR v2 迁移设计](/specs/ir-v2)

## 理论验收

统计功能不只是"跑得动"，还带解析解验收：

- M/M/1、M/M/c、故障模型：`examples/*.expect.json` 容差双通道（CI 区间覆盖或点估计）
- ODE：指数衰减、logistic、SIR、谐振子的解析解验收

## 测试矩阵

- 139 个 CTest（内核单元/集成/确定性/互操作/验收）
- 前端：renderer2d vitest（wire 解码）、protocol 互操作校验、浏览器 E2E（动画/图表/AI 面板）
