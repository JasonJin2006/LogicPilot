import { defineConfig } from 'vitepress'

// Lightweight TextMate grammar for the LogicPilot DSL (Shiki). The full
// grammar lives in dsl/tree-sitter-logicpilot; this is a small hand-written
// subset so code blocks get keyword/comment highlighting.
const logicpilotLanguage = {
  id: 'logicpilot',
  name: 'logicpilot',
  scopeName: 'source.logicpilot',
  patterns: [
    {
      match:
        '\\b(model|resource|process|source|queue|service|atomic|agent|' +
        'continuous|experiment|couple|state|param|on_input|on_timeout|' +
        'on_tick|time_advance|capacity|failure_rate|arrival|time|' +
        'objective|metric|variable|range|budget)\\b',
      name: 'keyword.control.logicpilot',
    },
    {
      match:
        '\\b(poisson|exponential|normal|constant|infinite|flip|bounce|' +
        'minimize|maximize|emit)\\b',
      name: 'support.function.logicpilot',
    },
    {
      match: '\\b(true|false)\\b',
      name: 'constant.language.logicpilot',
    },
    {
      match: '\\b\\d+(\\.\\d+)?\\b',
      name: 'constant.numeric.logicpilot',
    },
    { match: '//.*$', name: 'comment.line.logicpilot' },
  ],
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'LogicPilot',
  titleTemplate: ':title · LogicPilot',
  description:
    'AI 原生、Web 化、高性能的多方法仿真平台（离散事件 / DEVS / Agent / 连续）',
  lastUpdated: true,
  appearance: 'dark',
  head: [
    // Tab favicon: same logo as the homepage/navbar (docs/public/logo.svg).
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  markdown: {
    languages: [logicpilotLanguage],
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '用户手册', link: '/guide/quickstart' },
      { text: '开发文档', link: '/roadmap' },
      { text: '示例模型', link: '/guide/dsl#示例模型' },
      {
        text: '仓库',
        items: [
          {
            text: 'GitHub',
            link: 'https://github.com/JasonJin2006/LogicPilot',
          },
        ],
      },
    ],
    sidebar: [
      {
        text: '用户手册',
        collapsed: false,
        items: [
          { text: '快速开始', link: '/guide/quickstart' },
          { text: 'lpcli 命令参考', link: '/guide/cli' },
          { text: 'DSL 语言速查', link: '/guide/dsl' },
          { text: 'Web IDE 使用', link: '/guide/web-ide' },
          { text: 'AI Copilot', link: '/guide/ai-copilot' },
          { text: '确定性复现与契约', link: '/guide/determinism' },
          { text: 'FAQ / 排错', link: '/guide/faq' },
        ],
      },
      {
        text: '开发文档',
        collapsed: false,
        items: [
          {
            text: '总览',
            collapsed: true,
            items: [
              { text: '总计划与现状', link: '/roadmap' },
              { text: '性能预算', link: '/performance-budget' },
            ],
          },
          {
            text: '规范（现行）',
            collapsed: true,
            items: [
              { text: 'DSL 规范', link: '/specs/dsl-spec' },
              { text: 'DSL 冻结契约', link: '/specs/dsl-freeze' },
              { text: '工程格式 v2', link: '/specs/project-format-v2' },
              { text: 'Method Runtime Layer', link: '/specs/method-runtime' },
              { text: '流程库图标规范', link: '/specs/process-library-icons' },
              { text: 'Agent-centric 模型结构', link: '/specs/agent-centric' },
              { text: 'AI 建模闭环', link: '/specs/ai-loop' },
            ],
          },
          {
            text: '设计记录（历史）',
            collapsed: true,
            items: [
              { text: 'DSL v2 设计', link: '/specs/dsl-v2' },
              { text: 'IR v2 迁移设计', link: '/specs/ir-v2' },
              { text: 'IDE 布局与面板系统', link: '/specs/ide-layout' },
              { text: '里程碑 1 故障模型', link: '/specs/milestone1-failure-model' },
            ],
          },
          {
            text: '架构决策（ADR）',
            collapsed: true,
            items: [
              { text: '0001 C++20 无模块', link: '/adr/0001-cpp20-no-modules' },
              { text: '0002 CMake + vcpkg', link: '/adr/0002-cmake-vcpkg-package-management' },
              { text: '0003 最小 C++ 依赖集', link: '/adr/0003-cpp-dependency-minimal-set' },
              { text: '0004 FlatBuffers IR/wire', link: '/adr/0004-flatbuffers-ir-wire' },
              { text: '0005 tree-sitter 生成物入库', link: '/adr/0005-tree-sitter-parser-checked-in' },
              { text: '0006 推迟 GPU/分布式时间弯曲', link: '/adr/0006-defer-gpu-distributed-timewarp' },
              { text: '0007 保守并行优先', link: '/adr/0007-conservative-parallelism-first' },
              { text: '0008 vendored tree-sitter runtime', link: '/adr/0008-vendored-tree-sitter-runtime' },
              { text: '0009 运行时执行策略（并行+脚本）', link: '/adr/0009-runtime-execution-strategy' },
            ],
          },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
    },
    footer: {
      message: 'LogicPilot · AI 原生仿真平台',
    },
  },
})
