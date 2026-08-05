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
      { text: '用户手册', link: '/manual/01-quickstart' },
      { text: '开发文档', link: '/specs/dsl-spec' },
      { text: '示例模型', link: '/manual/03-dsl#示例模型' },
    ],
    sidebar: [
      {
        text: '用户手册',
        items: [
          { text: '快速开始', link: '/manual/01-quickstart' },
          { text: 'lpcli 命令参考', link: '/manual/02-cli' },
          { text: 'DSL 语言速查', link: '/manual/03-dsl' },
          { text: 'Web IDE 使用', link: '/manual/04-web-ide' },
          { text: 'AI Copilot', link: '/manual/05-ai-copilot' },
          { text: '确定性复现与契约', link: '/manual/06-determinism' },
          { text: 'FAQ / 排错', link: '/manual/07-faq' },
        ],
      },
      {
        text: '开发文档',
        items: [
          { text: '总计划与现状', link: '/roadmap' },
          { text: 'DSL 规范', link: '/specs/dsl-spec' },
          { text: 'DSL v2 重设计（草案）', link: '/specs/dsl-v2' },
          { text: 'IR v2 迁移设计', link: '/specs/ir-v2' },
          { text: '工程格式（Project Format）', link: '/specs/project-format' },
          { text: 'Node 场景模型', link: '/specs/node-scene-model' },
          { text: 'AI 建模闭环', link: '/specs/ai-loop' },
          { text: '里程碑 1 故障模型', link: '/specs/milestone1-failure-model' },
          { text: '性能预算', link: '/performance-budget' },
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
