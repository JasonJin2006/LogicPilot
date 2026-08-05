#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/ir_dump.h"
#include "logicpilot/devs/ir_loader.h"

int main(int argc, char** argv) {
  if (argc < 2) return 2;
  std::ifstream in(argv[1], std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  const std::string source = buffer.str();
  const logicpilot::dsl::CompileResult result =
      logicpilot::dsl::compile_source(source, argv[1]);
  std::printf("ok=%d diags=%zu\n", result.ok ? 1 : 0,
              result.diagnostics.size());
  if (!result.ok) return 1;
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      result.v2_bytes.data(), result.v2_bytes.size());
  std::printf("load ok=%d\n", loaded.ok() ? 1 : 0);
  if (loaded.ok()) {
    std::printf("%s\n", logicpilot::dsl::dump_ir(loaded.file).c_str());
  }
  return 0;
}
