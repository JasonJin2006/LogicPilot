# 平台契约规范（Phase 1 冻结）

状态：**已冻结**（基线见 `schemas/contracts/baseline/`）
依据：`docs/architecture/next-generation-plugin-platform.md` §16 Phase 1；
决策记录：[ADR-0069](../adr/0069-platform-contracts-freeze.md)

## 1. 契约目录与事实来源

```text
schemas/contracts/
  common.schema.json              共享 id/版本/provenance/自由 JSON 标记
  plugin-manifest-v2.schema.json  PluginManifest v2、依赖、entrypoints、迁移、
                                  完整性、logicpilot.lock 条目
  permission-trust.schema.json    PermissionId、TrustLevel T0–T5、授权、信任策略
  artifact-graph.schema.json      Artifact/Revision/Relation/Transaction/TypedOperation
  knowledge-block.schema.json     KnowledgeBlock、FormulaContent、KnowledgePack
  diagnostic.schema.json          DiagnosticDefinition/Instance/FixDefinition
  view-notation.schema.json       CanvasEngineId、ViewDefinition、NotationPack、CreateAction
  agent-engine.schema.json        AgentStepRequest/Result、ToolDescriptor、AgentCheckpoint
  execution-target.schema.json    ExecutionTarget/Request/Run/Evidence、RuntimeRef
  plugin-catalog.schema.json      PluginCatalog 发现信封（Phase 2B-1，ADR-0071：scope、
                                  rootId、相对 path、sha256、结构化 diagnostics）
  baseline/                       冻结快照（schema compatibility 门禁的对照物）
```

JSON Schema（draft 2020-12）是唯一事实来源。TS 与 C++ 类型全部由
`node scripts/gen-contracts.mjs` 生成：

- TS：`web/packages/contracts/src/generated/{contracts,schemas,registry}.ts`
- C++：`kernel/include/logicpilot/contracts/contracts_generated.h`
  与 `kernel/src/contracts/contracts_generated.cpp`

`logicpilot.plugin-catalog/v1`（Phase 2B-1）是首个非 Phase 1 原始清单的冻结信封：它引用
`PluginManifest` / `PluginId` / `Sha256Hex`，新增 `PluginScope`（system|user|workspace）等
枚举；宿主侧跨实体规则（entry.id == manifest.id、rootId 对应同 scope root、path 无 `..`
段）由 `@logicpilot/plugin-host` 的载荷校验在生成校验之上强制。禁止手写与其重复的
catalog 类型。

禁止手写与生成类型重复的定义；行为扩展写在
`kernel/src/contracts/contracts.cpp`、`web/packages/contracts/src/*` 这类
非 generated 文件里。

## 2. 契约级约束

1. **严格对象政策**：除标记 `x-freeform-json` 的两个自由载荷
   （`JsonSchemaFragment`/`JsonValue`）外，所有 object 定义必须
   `additionalProperties: false`。未知字段一律拒绝。
2. **版本字段**：版本化载荷必须带 `schema` 常量（如
   `logicpilot.plugin-manifest/v2`）与 `contractVersion` 常量（当前 `1`）。
   生成解析器强制两者；宿主另用 `SUPPORTED_PLUGIN_API_VERSIONS`（当前 `[1]`）
   校验 manifest 的 `apiVersion`。
3. **命名规则**：所有 `$defs` 全目录唯一；object 属性必须引用具名定义、
   原始类型、const、数组或 map，禁止内联嵌套对象（生成器会报错）。
4. **稳定 ID**：Plugin/Capability id 为小写点分串；诊断 ID 形如
   `SY0001`/`SL0003`/`LP3103`（pattern `^[A-Z]{2,6}[0-9]{3,5}$`）。

## 3. 门禁

| 门禁                 | TS                                         | C++                        | 脚本                                      |
| -------------------- | ------------------------------------------ | -------------------------- | ----------------------------------------- |
| round-trip           | `pnpm --filter @logicpilot/contracts test` | `test_contracts.cpp`       | —                                         |
| 未知字段拒绝         | 同上                                       | 同上                       | check-contract-conform 审计政策           |
| 版本检查             | 同上                                       | 同上                       | —                                         |
| 依赖环               | `resolveActivationOrder`                   | `resolve_activation_order` | —                                         |
| schema compatibility | —                                          | —                          | `node scripts/check-contract-conform.mjs` |

原生门禁统一走 `./scripts/windows-build.ps1 -Preset windows-msvc-dev [-Test]`。

## 4. 变更流程

1. 修改 `schemas/contracts/*.schema.json`；
2. `node scripts/gen-contracts.mjs` 重新生成 TS/C++；
3. 修改/新增门禁测试；
4. `node scripts/check-contract-conform.mjs` 会失败 —— **在同一次提交**里
   把变更后的 schema 覆盖到 `schemas/contracts/baseline/`，并在提交说明中
   声明破坏性变更与迁移方案（对齐 ADR-0004 的冻结更新流程）；
5. 跨阶段契约变更需新增/修订 ADR。

## 5. 与旧机制的关系

- `schemas/method_plugin.schema.json`（v1 方法插件 manifest）与其 C++ 解析器
  保留至 Phase 2（Plugin Host）迁移完成，届时按 §17 破坏性迁移规则删除，
  不留长期 facade。
- `logicpilot.lock` 契约（`PluginLockfile`）已冻结但消费者在 Phase 2 落地。
