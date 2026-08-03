# lp-server — LogicPilot WebSocket 网关（Phase 2c / 任务 #7）

Boost.Beast 实现的 WebSocket 网关，与仿真内核同进程运行，向浏览器等客户端
实时推送 wire.fbs（identifier `"LPWR"`）二进制遥测帧。

## 构建

随主构建一起产出（`cmake --build <build-dir>`）：

- `build/<cfg>/kernel/lp-server.exe` — 独立网关入口
- `build/<cfg>/kernel/apps/lpcli/lpcli.exe` — `serve` 子命令内嵌同一网关

## 启动方式

```powershell
# 方式 1：lpcli serve（DSL -> IR -> 网关，一条命令）
lpcli serve examples/mm1.lp --port 8089 --seed 42

# 方式 2：直接给已编译 IR
lpcli serve --model-file model.ir.bin --port 8089

# 方式 3：独立网关（缺省使用内置 M/M/1）
lp-server --model-file examples/mm1.ir.bin --port 8089 --seed 42
```

常用选项：`--port`（默认 8089，端点 `ws://127.0.0.1:<port>/sim`）、
`--seed`、`--reps`、`--arrivals`、`--warmup`、`--speed`（墙钟倍率）、
`--trace`。`Ctrl+C` 退出。

## 协议

### 控制（客户端 → 服务器，JSON 文本帧）

| 消息 | 说明 |
| --- | --- |
| `{"cmd":"start","seed":42,"reps":3,"arrivals":4000,"warmup":400,"speed":10}` | 开始运行（seed/reps/arrivals/warmup/speed 均可省略，取服务器默认） |
| `{"cmd":"pause"}` | 暂停（线程安全） |
| `{"cmd":"resume"}` | 恢复 |
| `{"cmd":"step"}` | 暂停时单步推进一个发射间隔 |
| `{"cmd":"stop"}` | 取消当前运行（发 RunFinished{Cancelled}） |
| `{"cmd":"speed","speed":10}` | 运行中调整墙钟倍率（不影响结果确定性） |

应答：`{"ok":true,"cmd":"start"}`；出错时
`{"ok":false,"error":"unknown command 'launch'"}`。

### 遥测（服务器 → 客户端，二进制帧）

每帧为 size-prefixed FlatBuffer（`schemas/wire.fbs`，identifier `LPWR`，
version 1）：`FrameHeader{version,seq,sim_time_ns,kind}` + 载荷。
一次运行的帧序：

```
RunStarted -> (Tick, Counters)* -> RunFinished
```

- 默认按 100 ms 仿真步长发一对 Tick+Counters（speed=1 时即 10 Hz）；
  `speed` 只改变墙钟节流速率，同 seed 结果逐位一致。
- MM1 映射：Tick.deltas 以在场顾客为对象——id 稳定（顾客序号），
  服务中顾客位于原点且 `state_bits` bit0=1，排队顾客按队列位置排列
  `pos_x=1,2,...`、`state_bits=0`，`flags=0x3`（位置+状态有效）。
- Counters：`queue_length`、`busy`、`throughput`、`mean_wait`（累计 Wq
  均值）、`mean_sojourn`、`mean_in_system`、`mean_in_queue`、`arrivals`、
  `departures`、`rep`、`reps`。
- RunFinished.stats：`reps`、`confidence` 以及 throughput/L/Lq/W/Wq 的
  `*.mean`、`*.std`、`*.ci_low`、`*.ci_high`（跨 replication 的 Student-t CI）。

### 交互示例（浏览器）

```js
const ws = new WebSocket('ws://127.0.0.1:8089/sim');
ws.binaryType = 'arraybuffer';
ws.onopen = () => ws.send(JSON.stringify({cmd: 'start', seed: 42, speed: 50}));
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') { console.log('ack', ev.data); return; }
  // ev.data 为 LPWR FlatBuffer：用 web/packages/protocol 生成的 TS 绑定解析
};
```

## --trace 调试模式

`--trace` 将每个发出的二进制帧同时以人类可读 JSON 打印到 stdout：

```text
[trace] {"frame":"RunStarted","seq":1,"sim_time_ns":0,"payload":{"run_id":"run-1","model":"mm1","seed":42}}
[trace] {"frame":"Tick","seq":2,"sim_time_ns":0,"payload":{"deltas":[{"id":0,"x":0.00,"y":0.00,"state":1}]}}
[trace] {"frame":"Counters","seq":3,"sim_time_ns":0,"payload":{"queue_length":0,"busy":1,"throughput":0,...}}
[trace] {"frame":"RunFinished","seq":20000,"sim_time_ns":999889752957,"payload":{"run_id":"run-1","status":"Completed","stats":{"Wq.mean":2.189,...}}}
```

## 测试

```powershell
ctest --test-dir build/local-mingw -R server   # 5 个集成/确定性用例
```

`kernel/tests/test_lp_server_integration.cpp`：内嵌 Beast 客户端走
DSL → IR → 网关全流程，校验帧序/identifier/version/seq 单调、统计落入
`examples/mm1.expect.json` 容差、两次运行 Counters 终值逐位一致，以及流式
驱动与内核 `QueueingFlowSim::run()` 的位级等价。
