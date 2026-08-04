# LogicPilot 智能开发集团（Simulation OS 开发组）

- **成立日期**: 2026-08-04
- **使命**: 以多智能体团队形式推进 Simulation OS（AI 原生、Web 化、高性能、多尺度、多物理、多 Agent 的仿真开发平台）的持续开发。
- **战略资产**（按优先级）: 多形式规范层 + 组合接口（Simulation IR）、DSL（人与 AI 共用的模型语言）、高性能仿真运行时、行业模型库。

## 组织架构

| 工作组 | 职责 | 工作流 / 主要目录 |
|---|---|---|
| 内核运行时组 | 事件引擎、多方法执行、确定性、性能 | `kernel/src`, `kernel/include` |
| DSL 与编译器组 | 文法、语义分析、降级、诊断（含 AI 可读的结构化诊断） | `dsl/`, `schemas/` |
| Web 与可视化组 | IDE、2D/3D 可视化、模型浏览 | `web/` |
| AI 与 Copilot 组 | NL→DSL 生成、诊断迭代闭环、自动优化（规划中） | `web/`, `scripts/` |
| 测试与验收组 | 单元/集成/理论验收、确定性、CI 门禁 | `kernel/tests`, `dsl/compiler/tests`, `.github/` |
| 集成与发布（根代理） | 契约冻结、跨组集成、checkpoint 提交 | 仓库根 |

## 当前成员

- `/root`（集成与发布）：负责总体协调、契约定义、集成构建、checkpoint 提交。
- 子代理按里程碑动态成立，工作流之间**文件互不重叠**，通过共享契约（IR 参数名、语义定义）对齐。

## 工作协议

1. **git 纪律**: 每个里程碑结束由集成者提交 checkpoint（`main`，中文或英文常规 commit message）；未获请求不新建分支；工作区不承诺不提交（子代理一律不提交，改动留在工作区由集成者统一提交）。
2. **构建隔离**: 每个工作流使用独立的构建目录 `build/<workstream>-dev`，禁止并发 ninja 进同一构建目录（会损坏 `.ninja_log`/`.ninja_deps`）。
3. **契约冻结**: F1（`schemas/ir.fbs`）与 F2（`schemas/wire.fbs`）为冻结契约；任何变更必须走 `scripts/check-schema-conform.ps1` 冻结流程并同 commit 更新 `schemas/baseline/`。子代理默认不得改动 `schemas/`。
4. **验收标准**: 新功能必须有 (a) 单元测试、(b) 端到端验收（理论值对拍或黄金值）、(c) 确定性（固定种子逐位复现）三件套之一以上；不得破坏现有 88 个 ctest 与前端测试。
5. **跨组对齐**: 涉及两个以上工作流的语义变更，由集成者先写契约规格（`docs/specs/`），子代理按规格实现，禁止自行发明接口。

## 路线图状态

- Phase 0（理论设计）: ✅ 完成（ADR-0001..0008、dsl-spec、F1/F2 冻结）。
- Phase 1（核心引擎）: ✅ MVP 完成；✅ 多服务器 M/M/c + 机器故障（里程碑 1）；✅
  AtomicModel DEVS 通用执行（IR 解释器 + DevsExecutor + atomic DSL，里程碑 1b）；
  Agent E2E 未开始。
- Phase 2（DSL）: ✅ v0 + atomic 块完成；✅ 结构化诊断（AI 闭环地基）；
  experiment/表达式 未开始。
- Phase 3（Web IDE）: 🔶 2D 可视化切片完成；拖拽建模/AI 面板未开始。
- Phase 4/5/6（2D/3D、行业库、AI）: ⬜ 未开始。
