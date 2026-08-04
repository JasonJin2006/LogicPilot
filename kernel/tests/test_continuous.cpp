// Continuous (ODE) engine tests (Phase D): expression evaluator, RK4
// integration vs analytic solutions (exponential decay + logistic), the
// v2-native path and the v1 EquationModel compatibility path, determinism.
#include <cmath>
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>

#include <flatbuffers/flatbuffers.h>

#include "ir_generated.h"
#include "ir_v2_generated.h"

#include "logicpilot/devs/continuous.h"
#include "logicpilot/devs/ir_loader.h"

using namespace logicpilot;
using Catch::Approx;

namespace {

namespace v2 = logicpilot::ir::v2;
namespace v1 = logicpilot::ir;

double evaluate(const std::string& text,
                const std::unordered_map<std::string, double>& vars) {
  ExpressionEvaluator evaluator{text};
  REQUIRE(evaluator.ok());
  return evaluator.eval([&](const std::string& name) {
    const auto it = vars.find(name);
    return it != vars.end() ? it->second : 0.0;
  });
}

std::vector<std::uint8_t> make_v2_equation(const char* rhs, double k,
                                           double y0) {
  flatbuffers::FlatBufferBuilder builder;
  const auto k_var = v2::CreateVar(
      builder, builder.CreateString("k"), v2::VarType_Float, false, 0, k, 0,
      0);
  std::vector<flatbuffers::Offset<v2::Var>> params{k_var};
  const auto equation = v2::CreateEquation(
      builder, builder.CreateString("y"), builder.CreateString(rhs), y0);
  std::vector<flatbuffers::Offset<v2::Equation>> equations{equation};
  const auto semantics =
      v2::CreateSemanticsRef(builder, builder.CreateString("sd"),
                             builder.CreateString("equation"), 0, 0);
  const auto node = v2::CreateNode(
      builder, 0, 0, builder.CreateVector(params), 0, semantics, 0, 0, 0, 0,
      builder.CreateVector(equations));
  const auto metadata = v2::CreateMetadata(
      builder, builder.CreateString("decay"), 0, 0, 0);
  const auto file = v2::CreateModelFile(builder, 2, node, 0, metadata);
  builder.Finish(file, "LP2R");
  return std::vector<std::uint8_t>(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());
}

std::vector<std::uint8_t> make_v1_equation(const char* rhs, double y0) {
  flatbuffers::FlatBufferBuilder builder;
  const auto variable = v1::CreateEquationVariable(
      builder, builder.CreateString("y"), y0, 0);
  std::vector<flatbuffers::Offset<v1::EquationVariable>> variables{variable};
  std::vector<flatbuffers::Offset<flatbuffers::String>> equations{
      builder.CreateString(rhs)};
  const auto model = v1::CreateEquationModel(
      builder, 0, builder.CreateVector(variables),
      builder.CreateVector(equations), 0);
  const auto root = v1::CreateModel(builder, v1::ModelKind_EquationModel,
                                    model.Union());
  const auto file = v1::CreateModelFile(builder, 1, root, 0, 0);
  builder.Finish(file, "LPIR");
  return std::vector<std::uint8_t>(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());
}

}  // namespace

TEST_CASE("expression evaluator handles the v0 RHS grammar", "[continuous]") {
  REQUIRE(evaluate("-k*y", {{"k", 0.5}, {"y", 2.0}}) == Approx(-1.0));
  REQUIRE(evaluate("r*y*(1-y/K)",
                   {{"r", 1.0}, {"y", 0.5}, {"K", 1.0}}) == Approx(0.25));
  REQUIRE(evaluate("2*(3+4)", {}) == Approx(14.0));
  REQUIRE(evaluate("1-2", {}) == Approx(-1.0));
  REQUIRE(evaluate("1e-2", {}) == Approx(0.01));

  ExpressionEvaluator bad{"-k*y +"};
  REQUIRE_FALSE(bad.ok());
}

TEST_CASE("v2-native RK4 matches exponential decay analytically",
          "[continuous][ir-v2]") {
  // dy/dt = -k*y, y(0)=1, k=0.5 -> y(10) = e^{-5}.
  const std::vector<std::uint8_t> v2 = make_v2_equation("-k*y", 0.5, 1.0);
  IrLoadResult loaded = load_model_buffer(v2.data(), v2.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.v2_root != nullptr);
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;  // 1000 steps * 0.01 = t=10
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.horizon_seconds == Approx(10.0));
  REQUIRE(metrics.final_value == Approx(std::exp(-5.0)).margin(1e-6));
}

TEST_CASE("v2-native RK4 matches the logistic solution analytically",
          "[continuous][ir-v2]") {
  // dy/dt = y*(1-y) (r=K=1 baked into the RHS), y(0)=0.1.
  const std::vector<std::uint8_t> v2 =
      make_v2_equation("1*y*(1-y)", 1.0, 0.1);
  IrLoadResult loaded = load_model_buffer(v2.data(), v2.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;  // t = 10
  const ReplicationMetrics metrics = model->run(config, nullptr);
  const double t = 10.0;
  const double expected =
      1.0 * 0.1 * std::exp(t) / (1.0 + 0.1 * (std::exp(t) - 1.0));
  REQUIRE(metrics.final_value == Approx(expected).margin(1e-3));
}

TEST_CASE("v1 EquationModel executes through the compatibility path",
          "[continuous]") {
  const std::vector<std::uint8_t> bytes = make_v1_equation("-0.5*y", 1.0);
  IrLoadResult loaded = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.final_value == Approx(std::exp(-5.0)).margin(1e-6));
}

TEST_CASE("continuous engine is deterministic", "[continuous][determinism]") {
  const std::vector<std::uint8_t> v2 = make_v2_equation("-k*y", 0.5, 1.0);
  IrLoadResult loaded = load_model_buffer(v2.data(), v2.size());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 500;
  const ReplicationMetrics first = model->run(config, nullptr);
  const ReplicationMetrics second = model->run(config, nullptr);
  REQUIRE(first.horizon_seconds == second.horizon_seconds);
  REQUIRE(first.final_value == second.final_value);
}
