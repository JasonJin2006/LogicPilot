# SysML v2 外部模型可视化

LogicPilot 当前优先支持“外部 SysML v2 文件 → 可编辑可视化投影”。SysML 源文件仍由
专业 SysML 工具负责生成和维护；LogicPilot 保存的是稳定元素关系的可视化布局侧车，
不会把不完整的投影解析器当成 SysML v2 编辑器。

## 使用方式

1. 在 Explorer 中打开包含 `.sysml` 文件的项目或文件夹。
2. 点击 `.sysml` 文件，Workbench 会打开 SysML projection 画布。
3. 使用 `Auto layout` 自动整理结构和关系。
4. 直接拖拽元素进行人工调整；缩放、平移和选中元素不会改变源文件。
5. 使用 `All / Structure / Requirements / Behavior / Traceability` 视图聚焦不同关系；布局修改支持
   Undo/Redo，Project 视图显示 SysML Outline，选中元素后右侧 SysML Properties 可
   精确修改坐标和查看关系。
6. 外部工具修改源文件后点击 `Refresh`，重新生成投影；已识别元素会尽量保留原布局。

项目 bundle 会在 `presentation/sysml/` 保存布局侧车；不属于 LogicPilot 项目的外部文件
使用本地浏览器存储保存布局。

## 当前识别范围

投影器是面向可视化的 best-effort 读取器，当前优先识别：

- package、part、item、port、interface；
- requirement、action、state、analysis、verification、attribute；
- containment、typing、specialization、connect、flow、satisfy、verify、trace、
  transition 关系。

未识别的 SysML 语法保留在源文本中，并以 projection warning 显示，不会被重写或静默
丢弃。完整 SysML v2 语法、标准模型交换和原生语义编辑属于后续路线。

## AI 能力

打开投影后，AI 可以使用以下建模工具：

- `inspect_sysml_projection`：读取元素、关系、源码行号、布局和投影警告；
- `auto_layout_sysml_projection`：重新生成确定性的结构布局；
- `set_sysml_projection_view`：在 all/structure/requirements/behavior/traceability 之间切换视图；
- `focus_sysml_element`：按名称、qualified name 或稳定 ID 定位元素并打开属性上下文；
- `move_sysml_element`：按元素稳定 ID 调整单个元素位置，不修改 SysML 源文件。

这使 AI 可以先帮助整理大型系统结构图，之后再发展需求、行为、分析 case 和执行
目标的 SysML 原生建模能力。
