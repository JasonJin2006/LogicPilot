# 工程格式（Project Format）：目录 + 单文件打包

状态：v1 草案（2026-08-05）。目标：给"一个建模仿真项目"一个可交付、可版本管理、
可被 AI 生成/修复的落地形态。与 DSL v2（薄语法层）、IR v2（冻结契约）对应，
工程是"源文件 + 派生产物 + 运行时产出"的组织单元。

## 1. 结论（一句话）

一个工程 = **一个模型 + 它的世界**：清单（manifest）+ 模型源（DSL）+
表现层（画布布局）+ 工程级库 + 实验预设。工作形态是**目录**，分享/保存形态是
**单文件 `*.lpproj` 打包**（当前为 JSON bundle，后续可无损展开为目录）。

## 2. 现状与动机

| # | 问题 | 现状证据 |
|---|---|---|
| P1 | 保存 `.lp` 只序列化 DSL，画布坐标/连线/表现层全部丢失，重开布局回不来 | `generateDsl` 只输出语法，不输出坐标 |
| P2 | 无工程边界：自定义库、实验预设、运行结果、种子/契约版本散落在 CLI 参数与 localStorage | `recentStore` 只存 `{name, dsl}` |
| P3 | 无"源 / 派生 / 运行时"分层，编译产物与运行结果没有归属地 | 无 `build/`、`results/` 概念 |

## 3. 三层模型

- **source（人/AI 可写）**：`model/*.lp`、`presentation/*.json`、`lib/*.lplib`、`logicpilot.json`
- **derived（编译产物，gitignore）**：`build/main.lpir`、`build/schema.sha256`
- **runtime（运行产出，gitignore）**：`results/<run-id>/...`

DSL 永远不掺坐标；画布布局是表现层，单独成文件。这样 DSL 保持薄、可 diff、
AI 可整文件生成，布局交给 IDE 管。

## 4. 规范目录布局

```
factory-twin.lpproj/                  # 一个工程 = 一个模型 + 它的世界
├── logicpilot.json                   # 清单（唯一必需文件）
├── model/
│   └── main.lp                       # DSL v2 源（入口）
├── presentation/
│   ├── main.canvas.json              # 画布布局：节点 x/y、连线、参数、库标记
│   └── assets/                       # 图标/图片/GLTF（未来表现层资产）
├── lib/
│   └── custom.lplib                  # 工程级自定义块库（可选）
├── experiments/
│   └── tune.json                     # 运行预设 / 实验覆盖（可选）
├── build/                            # 派生产物（gitignore）
│   ├── main.lpir                     # 编译出的 IR v2（LP2R）
│   └── schema.sha256                 # 冻结的 schema 指纹
└── results/                          # 运行产出（gitignore）
    └── 2026-08-05T1100/
        ├── run.json                  # 实验 + 种子 + schema 版本
        ├── trajectory.jsonl          # 采样状态流
        └── metrics.json              # 最终指标
```

## 5. 清单 logicpilot.json

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | `"logicpilot.project"` | 格式标识，必填 |
| `version` | `int` | 清单版本，当前 `1` |
| `name` | `string` | 工程名（也是默认模型名） |
| `model` | `path` | 入口 DSL 文件，默认 `model/main.lp` |
| `presentation` | `path` | 画布布局文件，默认 `presentation/main.canvas.json` |
| `libraries[]` | `[{name, path}]` | 工程级块库（可选，Phase 3） |
| `defaultExperiment` | `string \| null` | 默认实验名（可选） |
| `defaults.seed` | `int` | 默认随机种子，当前默认 `42` |
| `defaults.schemaVersion` | `int` | 默认 IR 契约版本，当前默认 `2` |

## 6. 单文件 bundle（当前交换格式）

`*.lpproj` = 一个 JSON 信封，`files` 的键是目录相对路径，值是对应文件内容；
展开后即第 4 节的目录，无信息损失。

```json
{
  "schema": "logicpilot.project",
  "format": "bundle",
  "version": 1,
  "manifest": {
    "name": "MM1",
    "model": "model/main.lp",
    "presentation": "presentation/main.canvas.json",
    "defaultExperiment": null,
    "defaults": { "seed": 42, "schemaVersion": 2 }
  },
  "files": {
    "model/main.lp": "model MM1 { ... }",
    "presentation/main.canvas.json": "{ \"name\": \"MM1\", \"nodes\": [...], \"edges\": [...] }"
  }
}
```

## 7. 打开 / 保存语义

- **保存**：`generateDsl(document)` → `model/main.lp`；画布 `ModelDocument`（含坐标、
  连线、参数、库标记）→ `presentation/main.canvas.json`；两者写入 bundle。
- **打开**：读 bundle → **优先 canvas**（坐标/连线/id 完整还原），canvas 缺失时
  回退 `parseDsl(model/main.lp)`（自左向右排布、按声明序连线）。
- **兼容**：`.lp`（单模型源，无布局）与 `.json`（旧画布文档）仍可打开，作为
  "单模型源码"的轻量交换格式；工程是工作单元。
- **id 约定**：canvas 节点 id 是工程内唯一键；DSL 声明名通过 canvas 的
  `name` 字段与画布节点关联，DSL 自身不含 id。

## 8. 确定性

- `manifest.defaults` 钉扎默认 `seed` / `schemaVersion`；`run.json` 记录每次运行
  实际使用的种子与 schema 版本。
- `build/schema.sha256` 记录冻结契约指纹（沿用 `.bfbs` SHA256 双门禁），
  复现时校验"谁在什么 schema 下编译过"。

## 9. 迁移路线

- **v1（本迭代）**：bundle 格式 + IDE 保存/打开/最近切到 `.lpproj`；画布布局首次入库。
- **v2**：目录落地（Tauri 文件系统）＋ `lpcli` 接受工程输入、`results/` 落盘。
- **v3**：多模型文件、工程级自定义库、实验预设目录。
