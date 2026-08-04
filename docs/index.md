---
layout: home

hero:
  name: LogicPilot
  text: AI 原生 · Web 化 · 高性能仿真平台
  tagline: 用 DSL 描述模型、C++ 高速执行、浏览器实时可视化、AI 自动建模与优化
  actions:
    - theme: brand
      text: 快速开始
      link: /manual/01-quickstart
    - theme: alt
      text: DSL 语言速查
      link: /manual/03-dsl

features:
  - title: 多方法统一
    details: 离散事件（process）、DEVS 原子、Agent 群体、连续 ODE 系统——五种模型在同一套 IR（v2 Node/SemanticsRef）与引擎注册表下执行。
  - title: 确定性可复现
    details: 固定种子逐位可复现，xoshiro256++ + int64 纳秒定点时间 + FIFO tie-break，理论验收与 bit-exact 对拍贯穿 CI。
  - title: AI 建模闭环
    details: 自然语言 → DSL → 结构化诊断 → 自动修复 → 运行，规则 provider 离线可用，LLM provider 可选；自动优化与瓶颈归因开箱即用。
  - title: Web 实时可视化
    details: WebSocket + FlatBuffers 推流，PixiJS 2D 队列动画、实时图表、AI 面板轨迹/优化曲线。
  - title: 契约冻结
    details: F1（IR）/F2（wire）schema 双门禁冻结，v1/v2 契约双向互操作由 CI 逐字段校验。
---
