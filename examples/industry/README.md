# 行业示例模型（P3）

以 `SemanticsRef` 库注册表交付的行业建模示例。每个示例是一个 agent-centric
工程/模型文件，可直接 `lpcli compile` + `lpcli run`，或打包为 `.lpkg`/
`.lpproj` 分发（见 `scripts/logicpkg.mjs` 与 `docs/specs/project-format-v2.md`）。

| 文件 | 内容 |
| --- | --- |
| `manufacturing_line.lp` | 制造线：原料到达 → 钻床池（2 台，含故障）→ 装配（单台）→ 成品 |

验证：

```powershell
lpcli compile examples/industry/manufacturing_line.lp -o build/manufacturing.ir.bin
lpcli run --model-file build/manufacturing.ir.bin --seed 42 --reps 3 --arrivals 2000 --warmup 200
```

行业模型库（制造/物流/交通）后续以独立 `.lpkg` 包扩展：新块经 `.lplib` 声明、
内核引擎按 `{library, block}` 注册（见 `docs/specs/method-runtime.md`）。
