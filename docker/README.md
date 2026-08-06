# lp-server 容器部署（P3）

多阶段构建：`build` 阶段在 Ubuntu 24.04 上用 vcpkg 固定基线（
`39344dff...`，见 `docs/adr/0002`）编译 `lp-server` + `lpcli`；
`runtime` 阶段只拷贝两个二进制，无编译工具链。

## 构建与运行

```bash
docker build -t logicpilot/lp-server -f docker/Dockerfile .

# 内置 M/M/1 网关
docker run --rm -p 8089:8089 logicpilot/lp-server

# 指定模型（把 .lpir 挂载进容器）
docker run --rm -p 8089:8089 \
  -v "$PWD/examples:/models" \
  logicpilot/lp-server --model-file /models/mm1.ir.bin --port 8089
```

客户端连接 `ws://<host>:8089/sim`（wire.fbs，`LPWR`；协议见
`kernel/apps/lp-server/README.md`）。容器内 `lpcli` 可执行 `compile` /
`serve` / `run`（健康检查用 `lpcli run built-in:mm1`）。

## 说明

- 首次构建会编译 vcpkg 依赖（entt / flatbuffers / boost-beast / fmt /
  spdlog / catch2 / benchmark），耗时较长；之后由 Docker 层缓存。
- 日志走 stdout（`docker logs`）；`--trace` 可镜像 JSON 帧便于排查。
- 生产建议：前面加 TLS 终止（网关本身是明文 WS），并限制每客户端帧率。
