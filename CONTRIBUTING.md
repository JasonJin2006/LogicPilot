# 参与贡献（Contributing）

感谢你愿意为 LogicPilot 贡献力量。本仓库是公开项目，所有变更走 PR + CI 门禁，
合并到 `main`。请先读 [README](README.md)、[roadmap](docs/roadmap.md) 与
[dev-plan](docs/dev-plan.md) 了解现状与路线。

## 我该贡献什么

- **Bug 修复与测试补齐**：任何时间都欢迎（先写失败测试）。
- **路线内功能**：P0–P3 与 roadmap 的待办项；动手前在 issue/讨论中说明方案。
- **文档**：文档体系（`docs/`）与仓库代码保持同步，改代码请同步相关文档。
- **不要做的**：超出 [DSL 冻结契约](docs/specs/dsl-freeze.md) 的语言扩展、
  逻辑推理/规则引擎方向、与冻结契约（F1/F2）冲突的改动——除非先走 ADR。

## 开发环境

### Windows（MSVC）

```powershell
cmake --preset windows-msvc-dev
cmake --build --preset windows-msvc-dev
ctest --preset windows-msvc-dev
```

### Linux（clang）

```bash
cmake --preset linux-clang-dev
cmake --build --preset linux-clang-dev
ctest --preset linux-clang-dev
```

前端（Node ≥ 20 + pnpm 9）：

```bash
pnpm install
pnpm build && pnpm test
pnpm docs:build
```

桌面端（可选）：Rust 工具链，见 [desktop/README.md](desktop/README.md)。

## 提交与分支

- 分支名以 `codex/` 开头（或功能名）。
- 提交信息用约定式提交：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`，
  一段话说明「改了什么、为什么」。
- 每个里程碑在 `main` 打 checkpoint；CI 全绿才合。

## 纪律（必须遵守）

- **契约冻结**：`schemas/ir_v2.fbs`（F1）与 `schemas/wire.fbs`（F2）修改必须
  同时更新 `schemas/baseline/` 并跑通 conform 双门禁（ADR-0004）。
- **生成物同 commit**：`dsl/tree-sitter-logicpilot/src/` 是生成物（ADR-0005）；
  改 `grammar.js` 必须重新生成并同 commit，CI 会校验同步。
- **头文件改动需全量重建**：本机 MSVC+Ninja 的编译规则不追踪头文件依赖
  （unscanned），改头文件后请清掉受影响对象或全量重编，避免陈旧对象混入。
- **确定性**：固定种子必须逐位可复现；破坏确定性的改动不会被接受。
- **UI 字符串用英文**；中文只出现在 `docs/` 文档。

## 代码风格

- C++：C++20，`kernel/` 遵循 `.clang-format` 与 `.clang-tidy`（`/W4` /
  `-Wall -Wextra`）。
- TypeScript/React：`prettier` + `eslint`（`pnpm format:check`、`pnpm lint`）。
- 新增测试随功能提交；所有改动保持 `ctest` / `pnpm test` / `docs:build` 全绿。

## PR 流程

1. 从 `main` 切分支，小步提交。
2. 本地跑全量门禁（构建 + ctest + 前端 build/test + docs:build）。
3. 提交 PR，说明动机、改动、测试与影响面（涉及契约/架构需附 ADR 或链接）。
4. CI 全绿后合入。
