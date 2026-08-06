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

#include "ir_v2_generated.h"

#include "logicpilot/devs/continuous.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"

using namespace logicpilot;
using Catch::Approx;

namespace {

namespace v2 = logicpilot::ir::v2;

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

TEST_CASE("expression evaluator supports equality comparisons",
          "[continuous][condition]") {
  REQUIRE(evaluate("a == 5", {{"a", 5.0}}) == 1.0);
  REQUIRE(evaluate("a == 5", {{"a", 4.0}}) == 0.0);
  REQUIRE(evaluate("a != 5", {{"a", 4.0}}) == 1.0);
  REQUIRE(evaluate("a != 5", {{"a", 5.0}}) == 0.0);
  REQUIRE(evaluate("a == b", {{"a", 2.0}, {"b", 2.0}}) == 1.0);
  REQUIRE(evaluate("(a + b) == 7", {{"a", 3.0}, {"b", 4.0}}) == 1.0);
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

TEST_CASE("DSL continuous block runs end-to-end (decay example)",
          "[continuous][dsl]") {
  const dsl::CompileResult compiled =
      dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/decay.lp");
  REQUIRE(compiled.ok);
  REQUIRE_FALSE(compiled.v2_bytes.empty());

  // v2-native path (default contract).
  IrLoadResult v2_loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(v2_loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(v2_loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.final_value == Approx(std::exp(-5.0)).margin(1e-6));
  const auto* continuous =
      dynamic_cast<const ContinuousReplicationModel*>(model.get());
  REQUIRE(continuous != nullptr);
  REQUIRE(continuous->variables().size() == 1);
  const auto& trajectory = continuous->trajectory();
  REQUIRE(trajectory.size() == 1000);
  REQUIRE(trajectory.front().values[0] < 1.0);  // decayed after step 1
  REQUIRE(trajectory.back().values[0] ==
          Approx(std::exp(-5.0)).margin(1e-6));
}

TEST_CASE("coupled ODE system matches the harmonic oscillator analytic "
          "solution", "[continuous][dsl]") {
  // dx/dt = y, dy/dt = -x, x(0)=1, y(0)=0 -> x(t)=cos(t), y(t)=-sin(t).
  const std::string source =
      "model Osc {\n"
      "  continuous Dyn {\n"
      "    state x = 1.0\n"
      "    state y = 0.0\n"
      "    d x/dt = y\n"
      "    d y/dt = -x\n"
      "  }\n"
      "}\n";
  const dsl::CompileResult compiled =
      dsl::compile_source(source, "inline.lp");
  REQUIRE(compiled.ok);
  // The v2 contract must carry both equations with their exact RHS text.
  {
    const auto* file =
        logicpilot::ir::v2::GetModelFile(compiled.v2_bytes.data());
    REQUIRE(file != nullptr);
    const auto* root = file->root();
    REQUIRE(root != nullptr);
    const auto* child = root->children()->Get(0);
    REQUIRE(child->continuous() != nullptr);
    REQUIRE(child->continuous()->size() == 2);
    REQUIRE(child->continuous()->Get(0)->rhs_text()->str() == "y");
    REQUIRE(child->continuous()->Get(1)->rhs_text()->str() == "-x");
    REQUIRE(child->continuous()->Get(0)->initial_value() == 1.0);
    REQUIRE(child->continuous()->Get(1)->initial_value() == 0.0);
  }
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;  // t = 10
  const ReplicationMetrics metrics = model->run(config, nullptr);
  const auto* continuous =
      dynamic_cast<const ContinuousReplicationModel*>(model.get());
  REQUIRE(continuous != nullptr);
  const auto state = continuous->last_state();
  REQUIRE(state.at("x") == Approx(std::cos(10.0)).margin(1e-4));
  REQUIRE(state.at("y") == Approx(-std::sin(10.0)).margin(1e-4));
  REQUIRE(metrics.final_value == state.at("x"));
}

TEST_CASE("RHS functions and explicit time (exp(-t))",
          "[continuous][dsl]") {
  // dy/dt = exp(-t), y(0)=0 -> y(t) = 1 - e^{-t}; at t=1 -> 1 - e^{-1}.
  const std::string source =
      "model ExpT {\n"
      "  continuous Dyn {\n"
      "    state y = 0.0\n"
      "    d y/dt = exp(-t)\n"
      "  }\n"
      "}\n";
  const dsl::CompileResult compiled =
      dsl::compile_source(source, "inline.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 100;  // t = 1.0
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.final_value == Approx(1.0 - std::exp(-1.0)).margin(1e-4));
}

TEST_CASE("SIR epidemic conserves the population (S+I+R = 1)",
          "[continuous][dsl]") {
  const dsl::CompileResult compiled =
      dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/sir.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 1000;  // t = 10
  const ReplicationMetrics metrics = model->run(config, nullptr);
  const auto* continuous =
      dynamic_cast<const ContinuousReplicationModel*>(model.get());
  REQUIRE(continuous != nullptr);
  const auto state = continuous->last_state();
  const double total = state.at("S") + state.at("I") + state.at("R");
  REQUIRE(total == Approx(1.0).margin(1e-9));
  REQUIRE(state.at("I") > 0.0);  // epidemic ran
  REQUIRE(state.at("R") > 0.0);  // recovered
  REQUIRE(metrics.horizon_seconds == Approx(10.0));
}

TEST_CASE("sign of a lone negative RHS is preserved", "[continuous][dsl]") {
  // dy/dt = -x with x a constant param: y(1) must be -1, never +1.
  const std::string source =
      "model Neg {\n"
      "  continuous Dyn {\n"
      "    state y = 0.0\n"
      "    param x = 1.0\n"
      "    d y/dt = -x\n"
      "  }\n"
      "}\n";
  const dsl::CompileResult compiled =
      dsl::compile_source(source, "inline.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 100;  // t = 1
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.final_value == Approx(-1.0).margin(1e-4));
}

TEST_CASE("directly constructed coupled oscillator", "[continuous]") {
  flatbuffers::FlatBufferBuilder builder;
  std::vector<flatbuffers::Offset<v2::Var>> state{
      v2::CreateVar(builder, builder.CreateString("x"), v2::VarType_Float,
                    false, 0, 1.0, 0, 0),
      v2::CreateVar(builder, builder.CreateString("y"), v2::VarType_Float,
                    false, 0, 0.0, 0, 0),
  };
  std::vector<flatbuffers::Offset<v2::Equation>> equations{
      v2::CreateEquation(builder, builder.CreateString("x"),
                         builder.CreateString("y"), 1.0),
      v2::CreateEquation(builder, builder.CreateString("y"),
                         builder.CreateString("-x"), 0.0),
  };
  const auto semantics =
      v2::CreateSemanticsRef(builder, builder.CreateString("sd"),
                             builder.CreateString("equation"), 0, 0);
  const auto node = v2::CreateNode(
      builder, 0, builder.CreateVector(state), 0, 0, semantics, 0, 0, 0, 0,
      builder.CreateVector(equations));
  const auto file = v2::CreateModelFile(builder, 2, node, 0, 0);
  builder.Finish(file, "LP2R");
  std::vector<std::uint8_t> bytes(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());

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
  const auto* continuous =
      dynamic_cast<const ContinuousReplicationModel*>(model.get());
  REQUIRE(continuous != nullptr);
  const auto result = continuous->last_state();
  REQUIRE(result.at("y") == Approx(-std::sin(10.0)).margin(1e-4));
}
