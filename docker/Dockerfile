# LogicPilot runtime container (P3 cloud deployment): builds lp-server (and
# lpcli) with vcpkg-pinned dependencies, then runs the WebSocket gateway.
#
# Build:
#   docker build -t logicpilot/lp-server -f docker/Dockerfile .
# Run:
#   docker run -p 8089:8089 logicpilot/lp-server \
#     --model-file /models/mm1.lpir --port 8089

# ---- build stage ----------------------------------------------------------
FROM ubuntu:24.04 AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang cmake ninja-build git curl zip unzip tar pkg-config \
    && rm -rf /var/lib/apt/lists/*

ARG VCPKG_COMMIT=39344dff01c5a5a0134caf2624cdd492f05d30ea
RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
    && cd /opt/vcpkg && git checkout ${VCPKG_COMMIT} \
    && ./bootstrap-vcpkg.sh -disableMetrics

WORKDIR /src
COPY . .

# Configure with the Linux clang preset (vcpkg deps are built here; the
# CMake toolchain resolves through the VCPKG_ROOT env var).
ENV VCPKG_ROOT=/opt/vcpkg
RUN cmake --preset linux-clang-release \
      -DLOGICPILOT_BUILD_TESTS=OFF \
      -DLOGICPILOT_BUILD_DSL=ON \
    && cmake --build --preset linux-clang-release \
      --target lp-server lpcli -j"$(nproc)"

# ---- runtime stage --------------------------------------------------------
FROM ubuntu:24.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build \
  /src/build/linux-clang-release/kernel/lp-server \
  /usr/local/bin/lp-server
COPY --from=build \
  /src/build/linux-clang-release/kernel/apps/lpcli/lpcli \
  /usr/local/bin/lpcli

WORKDIR /work
EXPOSE 8089

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD lpcli run --model built-in:mm1 --seed 42 --reps 1 --arrivals 100 --warmup 0 >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/lp-server"]
