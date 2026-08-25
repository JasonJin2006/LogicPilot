# 可执行模型运行时架构

状态：核心契约与动态宿主已落地；作为历史兼容，接口名仍为 `SimulationMethod`。

> 范围说明（2026-08-23）：本文只规范**可执行模型的 runtime adapter**，不再定义
> LogicPilot 的完整建模分类。SysML/C4 文档类型不整体实现本接口；SysML v2 中
> 可执行的 behavior、calculation、analysis/verification case 通过显式 execution
> target 选择解释器、lowering backend 或外部工具。Workbench 文档/编辑器/AI
> 总架构与迁移见
> [`../workbench-architecture-plan.md`](../workbench-architecture-plan.md)。

## 1. 设计目标

本子系统的核心不是某一种仿真算法：内核只负责仿真时间、事件排序、可执行生命周期、
状态交换和诊断。DEVS/PDEVS、连续求解器、Process 优化执行器或外部 FMU 等通过
runtime adapter 接入；Process/Agent/Statechart 等建模视角与组件库可以通过 lowering
选择这些 adapter，但不因此与形式语义、求解器或执行策略处在同一分类层。

```text
DSL / library packages
        |
        v
IR v2: Node + SemanticsRef + ExtensionPayload
        |
        v
MethodRegistry ---- method plugin manifest
        |
        v
RuntimeManager ---- shared clock / scheduler / variables / messages
        |
        +-- ProcessRuntime
        +-- StatechartRuntime
        +-- third-party runtime
```

核心依赖方向只能是“adapter 依赖内核”。内核不得包含 Queue、Service、Stock、
Agent、SysML 等专属概念，也不得按注册名称写 `switch`。

## 2. IR 与运行时身份

每个可执行节点通过以下三元组声明语义：

```text
SemanticsRef { library, block, version }
```

- `library` 在现行 IR 中仍兼作运行时解析键，例如 `process`、`statechart`、`petri`；
  这是兼容边界，不是最终本体分类。后续将建模 library、formalism 与 runtime backend
  分离，旧值通过 lowering/registry 映射继续有效。
- `block` 是库内组件，例如 `service`、`place`。
- `version` 是该组件采用的语义契约版本，不是 LogicPilot 内核版本。

DSL 注册表必须把 `.lplib` 的库名和版本原样传到 IR。不同库可以声明相同短块名；此时模型必须写成 `library::block`。未限定且有歧义时编译器返回 `LP2013`，同一库内重复声明仍以 `LP2012` 拒绝。

现行仿真 IR 的通用结构使用 `Node` 的 state、params、ports、children 与 couplings；
runtime 专属的大型或异构数据使用
`ExtensionPayload {type_uri, schema_version, encoding, data}`。这不是 Workbench 所有
文档的万能模型：SysML、PDE、网格、外部仓库等可拥有自己的 document schema，并仅在
需要执行或联合仿真时 lowering 到仿真 composition/runtime contract。

## 3. 运行时契约

所有可执行 runtime adapter 当前实现 `SimulationMethod`：

```cpp
class SimulationMethod {
 public:
  virtual std::string_view method_name() const = 0;
  virtual MethodCapabilities capabilities() const;
  virtual bool initialize(RuntimeContext&, const IrModelFile&, std::string*) = 0;
  virtual void advance(SimTime until) = 0;
  virtual void shutdown() = 0;
};
```

`MethodCapabilities.execution_mode` 明确区分：

- `kSharedEventQueue`：方法把工作调度到内核队列，可与其他同类方法组合运行。
- `kDriverAdvanced`：旧引擎仍拥有私有执行循环，只能作为单一方法运行。

内核不会把第二种情况伪装成混合仿真。多方法模型中只要存在批处理运行时，执行会以 `KR1007` 失败。当前 Process、Statechart、DEVS、Agent 与 SD 均实现共享队列生命周期；旧批处理入口只作为单方法兼容适配器保留。

## 4. 方法发现与版本兼容

运行时发现递归遍历 IR 中所有非 `core` 的 `SemanticsRef.library`，不维护内置方法白名单。`process/resource` 是当前唯一明确声明的辅助节点，不单独形成运行时。

`MethodRegistry` 保存工厂与描述符：

```text
method -> factory + runtimeVersion + supported semanticsVersions
```

模型初始化前，内核会检查每个 IR 语义版本是否受已注册运行时支持；不兼容时返回 `KR1008`，避免“能加载但语义解释不同”的隐性错误。

## 5. 可安装插件清单

`schemas/method_plugin.schema.json` 定义版本化 JSON 清单，包含：

- 包名、方法名、运行时版本；
- 支持的语义版本；
- DSL 库文件；
- 运行时种类与入口点。

## 5.0 内置方法的构建期裁剪（ADR-0068）

四个内置方法插件（agent / process / sd / statechart）各自受 CMake 选项
`LOGICPILOT_METHOD_<NAME>`（默认 ON）控制：选项关闭时，方法库不参与
编译与链接，聚合注册体中对应的 `register_*_method()` 调用被
`LP_WITH_METHOD_*` 宏剔除。驱动无需改动；请求已裁剪方法的模型在运行期
得到既有 KR1004 错误。DEVS 内置运行时仍在内核核心内（见 ADR-0068 的
"非目标"一节），动态插件路径（`linked`/`c-abi`/`wasm` 清单）不受影响。

运行时种类支持 `linked`、`c-abi` 与 `wasm`。清单解析完成后，宿主装载 artifact、校验方法身份与 ABI，再把持有模块生命周期的 factory 注册到统一 `MethodRegistry`。runtime 可选 `artifactSha256` 用于加载前完整性 pin；它不是数字签名或信任链。清单只描述发现信息，不把 C++ 对象布局冒充稳定 ABI。

### 5.1 原生 C ABI v1

`method_plugin_abi.h` 是纯 C、追加式的版本化函数表。边界只传递固定宽度标量、FlatBuffer IR 字节和宿主回调，不传 STL、异常、RTTI 或 C++ 对象布局。插件可通过宿主表读取仿真时钟、调度/取消事件、读写 double 共享变量，并发布带类型 URI 的消息。插件必须导出清单 `entrypoint` 指定的 `lp_method_plugin_entrypoint_v1` 函数。

`lp_method_host_v1` 的追加字段 `register_message_type` 允许插件在初始化时注册
自己的 URI/schema/encoding 契约；宿主在字段由 `struct_size` 表示可用时提供该服务。
旧版插件看不到追加字段，仍按原有 ABI 工作。

### 5.2 WASM ABI v1

设置 CMake 的 `LOGICPILOT_WASMTIME_ROOT` 指向 Wasmtime C API 发行包后启用 WASM 宿主。宿主不授予 WASI，限制 WASM 栈并按 replication 预算 fuel；每个方法实例拥有独立 Store。v1 模块必须导出：

```text
lp_abi_version() -> i32
lp_initialize(seed:i64, arrivals:i64, warmup:i64) -> i32
lp_event_count() -> i64
lp_event_time_ns(index:i64) -> i64
lp_event_type(index:i64) -> i32
lp_event_payload(index:i64) -> i64
lp_on_event(type:i32, payload:i64) -> f64
lp_shutdown_arrivals() -> i64
lp_shutdown_departures() -> i64
lp_final_value() -> f64
```

WASM v1 采用确定性事件计划：初始化后由模块给出初始事件，宿主将其放入共享队列，并把事件逐个回送 `lp_on_event`。后续版本可追加受能力控制的动态调度 import，不破坏 v1 模块。

## 6. 跨方法通信

有两条互补通道：

- `VariableStore`：低频、可观察的共享标量状态（bool/int64/double/string）。
- `MessageStore`：类型化消息体，包含 `type_uri`、schema 版本、编码、来源方法和字节数据。

`VariableStore` 的 method API 通过 `VariableDeclaration` 声明 owner、unit、readers
和 writers；方法必须使用 `set_by(method, ...)` / `get_by(method, ...)`，未声明或
未授权访问会失败。无身份的 `set/get` 仅保留给 kernel/host 的兼容管理视图，不是
方法插件的权限边界。SD 运行时声明 `sd::<state>` 后按 `sd` 写入；C ABI host 对
插件自身首次写入的变量建立同名 owner 声明，仍禁止其他 method 借用其 writer 权限。

调度器的 `Event.payload` 继续保持 64 位，以保证热路径紧凑。复杂载荷时它保存 `MessageId`，指向一次 replication 内的 `MessageStore`；方法可用类型 URI 和版本校验后再解码。`MessageStore::register_type` 可为 URI 注册 schema/version 与 encoding 契约，已注册类型在 publish 和 checkpoint restore 时拒绝版本或编码漂移；未注册类型保留给旧插件的兼容扩展点。宿主通过 `ReplicationConfig.max_events` 为共享队列设置事件风暴上限，超限返回 KR1017。初始化或回滚时，变量与消息都会清空，不跨 replication 泄漏。

端口层的 `Port.event_type` 描述静态消息类型，`MessageEnvelope.type_uri` 描述运行时实际载荷。
编译器现在对已声明的 coupling 两端执行 LP5009 类型兼容检查：普通类型必须精确相等，
空类型（历史无类型端口）以及显式 `any`/`message` 接收端作为通配契约；不兼容连接在
进入 IR 和运行时之前即被拒绝。运行时仍应在消息解码处校验 `type_uri` 与 schema 版本，
因为动态插件消息不能仅依赖 DSL 静态类型。

DEVS 原子也保留这项类型元数据：IR v2 `Port.event_type` 会进入
`AtomicModel::port_type()`，`DevsRuntimePlan` 在展开层级 coupling 后再次检查每条
最终 output→input 路由。这样手工构造的 IR、原生插件或绕过 DSL 的模型不能以未知消息
类型加载成功；缺少类型的旧原子仍按兼容模式运行。

## 7. 新方法接入检查表

当前 Agent 实现位于 `methods/agent/`，SD 实现位于 `methods/sd/`，分别通过
`register_agent_method()` / `register_sd_method()` 加入聚合插件库；kernel 只
保留通用的 native DEVS 适配，不再定义 AgentMethod 或 SdMethod。

1. 提供 `.lplib`，声明唯一库名、版本和块形状。
2. lowering 生成正确的 `SemanticsRef`；专属数据放入版本化扩展载荷。
3. 实现 `SimulationMethod`，准确声明能力，不虚报共享调度或 checkpoint。
4. 提供方法插件清单并通过宿主适配器注册 factory。
5. 为支持的每个语义版本提供兼容测试。
6. 添加单方法执行、确定性、错误诊断测试；若声明共享队列，再添加多方法组合测试。

## 8. 仍需完成的边界

### 8.1 多 Statechart 事件顺序

同一 model root 下的多个 Statechart 由一个 `StatechartNetworkReplicationModel`
挂接到 SimulationKernel 的共享 scheduler。状态转换产生的 `emit` 消息在当前
事件处理期间立即路由到目标图，而不是等某个 chart 的整段 `advance()` 返回；
状态切换会取消旧的 timer/condition poll，避免 stale event 改变最终仿真 horizon。
这保证了 `(sim_time, scheduler sequence)` 的事件顺序可重放；消息环路仍受有界
cascade 保护。该边界已有 kernel coupling/determinism 验收覆盖。

- 为插件包增加发布者签名、信任策略与细粒度能力授权；当前 C ABI 插件与宿主同进程，只有 WASM 插件具备内存隔离和计算配额。
- 为 `VariableStore` 增加跨方法变量的声明式单位、所有权与读写权限 ✅；为端口增加
  类型兼容检查。
- 连续时间方法已增加确定性的自适应 RK4 误差控制、scheduler 步长预检和可选零
  交叉定位观测/observer hook；零交叉的精确离散调度与离散事件回滚协议仍是后续边界。

这些是超越 AnyLogic 扩展性的关键工程，不应靠 Java 式任意继承来替代明确、可版本化、可诊断的契约。
