# CallCenter 示例工程

一个可直接打开、编译和运行的 LogicPilot 工程（agent-centric 目录结构）：

```
call-center/
├─ logicpilot.json                    # 工程清单（manifest）
├─ model/main.lp                      # model 根：param / resource + 流程块 + couple
└─ presentation/main.canvas.json      # 纯布局（按稳定路径索引位置与连线）
```

## 打开

- 桌面客户端：`File > Open Project Folder` 选择本目录。
- 浏览器：`File > Open...` 无法直接打开目录；可将本目录打包为 `.lpproj` 后打开，
  或先 `lpcli compile --project .` 验证再使用。

## 命令行验证

```powershell
lpcli compile --project examples/call-center
```

## 模型

呼叫中心 M/M/2：泊松到达 λ=0.8，两个座席（Agent，capacity=2，故障率 2%），
指数服务 μ=1.0，队列容量 100。IDE 中打开根画布可见资源与全部流程块及其
couple 连线（扁平 agent-centric 结构，无 `process` 容器）；Run 可直接流式运行。
