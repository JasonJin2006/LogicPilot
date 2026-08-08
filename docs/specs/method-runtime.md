# 方法运行时架构

状态：核心契约与动态宿主已落地；Process、Statechart、DEVS、Agent、系统动力学以及插件运行时均可接入共享事件队列。

## 1. 设计目标

LogicPilot 的核心不是某一种仿真算法，而是一个“建模方法操作系统”：内核只负责仿真时间、事件排序、生命周期、状态交换和诊断；Process、Agent、系统动力学、Statechart、Petri 网以及未来的 FEM/PDE/FMU 都是可注册的方法运行时。

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

核心依赖方向只能是“方法依赖内核”。内核不得包含 Queue、Service、Stock、Agent 等方法专属概念，也不得按方法名称写 `switch`。

## 2. IR 与方法身份

每个可执行节点通过以下三元组声明语义：

```text
SemanticsRef { library, block, version }
```

- `library` 是运行时注册键，例如 `process`、`statechart`、`petri`。
- `block` 是库内组件，例如 `service`、`place`。
- `version` 是该组件采用的语义契约版本，不是 LogicPilot 内核版本。

DSL 注册表必须把 `.lplib` 的库名和版本原样传到 IR。不同库可以声明相同短块名；此时模型必须写成 `library::block`。未限定且有歧义时编译器返回 `LP2013`，同一库内重复声明仍以 `LP2012` 拒绝。

通用结构使用 `Node` 的 state、params、ports、children 与 couplings。方法专属的大型或异构数据使用 `ExtensionPayload {type_uri, schema_version, encoding, data}`。因此新增一种方法通常只需新 DSL 库、新运行时和新扩展 schema，无需修改核心 IR。

## 3. 运行时契约

所有方法实现 `SimulationMethod`：

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

运行时种类支持 `linked`、`c-abi` 与 `wasm`。清单解析完成后，宿主装载 artifact、校验方法身份与 ABI，再把持有模块生命周期的 factory 注册到统一 `MethodRegistry`。清单只描述发现信息，不把 C++ 对象布局冒充稳定 ABI。

### 5.1 原生 C ABI v1

`method_plugin_abi.h` 是纯 C、追加式的版本化函数表。边界只传递固定宽度标量、FlatBuffer IR 字节和宿主回调，不传 STL、异常、RTTI 或 C++ 对象布局。插件可通过宿主表读取仿真时钟、调度/取消事件、读写 double 共享变量，并发布带类型 URI 的消息。插件必须导出清单 `entrypoint` 指定的 `lp_method_plugin_entrypoint_v1` 函数。

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

调度器的 `Event.payload` 继续保持 64 位，以保证热路径紧凑。复杂载荷时它保存 `MessageId`，指向一次 replication 内的 `MessageStore`；方法可用类型 URI 和版本校验后再解码。初始化或回滚时，变量与消息都会清空，不跨 replication 泄漏。

端口层的 `Port.event_type` 描述静态消息类型，`MessageEnvelope.type_uri` 描述运行时实际载荷。后续应增加端口连接的编译期类型兼容检查。

## 7. 新方法接入检查表

1. 提供 `.lplib`，声明唯一库名、版本和块形状。
2. lowering 生成正确的 `SemanticsRef`；专属数据放入版本化扩展载荷。
3. 实现 `SimulationMethod`，准确声明能力，不虚报共享调度或 checkpoint。
4. 提供方法插件清单并通过宿主适配器注册 factory。
5. 为支持的每个语义版本提供兼容测试。
6. 添加单方法执行、确定性、错误诊断测试；若声明共享队列，再添加多方法组合测试。

## 8. 仍需完成的边界

- 为插件包增加发布者签名、信任策略与细粒度能力授权；当前 C ABI 插件与宿主同进程，只有 WASM 插件具备内存隔离和计算配额。
- 为 `VariableStore` 增加声明式单位、所有权与写入权限；为端口增加类型兼容检查。
- 定义连续时间方法的误差控制、零交叉与离散事件回滚协议。

这些是超越 AnyLogic 扩展性的关键工程，不应靠 Java 式任意继承来替代明确、可版本化、可诊断的契约。
