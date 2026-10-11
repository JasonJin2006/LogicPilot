#include <cstdint>
#include <iostream>
#include <limits>
#include <memory>
#include <string>

#include <nlohmann/json.hpp>

#include "logicpilot/dsl/compile.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "logicpilot/runtime/simulation_session.h"
#include "register.h"

using json = nlohmann::json;

namespace {

constexpr const char* kProtocol = "logicpilot.native-session/v1";

json error_response(std::uint64_t id, const std::string& message) {
  return json{{"id", id}, {"ok", false}, {"protocol", kProtocol}, {"error", message}};
}

json metrics_json(const std::vector<logicpilot::ReplicationMetrics>& metrics) {
  json result = json::array();
  for (const auto& metric : metrics) {
    result.push_back({
        {"arrivals", metric.arrivals},
        {"departures", metric.departures},
        {"horizonSeconds", metric.horizon_seconds},
        {"throughput", metric.throughput},
        {"meanInSystem", metric.mean_in_system},
        {"meanInQueue", metric.mean_in_queue},
        {"meanSojourn", metric.mean_sojourn},
        {"meanWait", metric.mean_wait},
        {"finalValue", metric.final_value},
    });
  }
  return result;
}

json telemetry_json(const logicpilot::SimulationSession& session) {
  std::vector<logicpilot::RuntimeTelemetryValue> values;
  session.collect_telemetry(values);
  json result = json::object();
  for (const auto& value : values) result[value.key] = value.value;
  return result;
}

std::int64_t until_ns(const json& request) {
  if (request.contains("untilNs")) return request.at("untilNs").get<std::int64_t>();
  return std::numeric_limits<std::int64_t>::max();
}

}  // namespace

int main() {
  logicpilot::register_all_methods();
  std::unique_ptr<logicpilot::SimulationSession> session;
  std::uint64_t next_id = 1;
  std::string line;

  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    json request;
    try {
      request = json::parse(line);
    } catch (const std::exception& error) {
      std::cout << error_response(0, std::string("invalid JSON: ") + error.what())
                       .dump()
                << '\n'
                << std::flush;
      continue;
    }
    const std::uint64_t id = request.value("id", next_id++);
    const std::string kind = request.value("kind", "");
    try {
      if (kind == "hello") {
        std::cout << json{{"id", id},
                          {"ok", true},
                          {"protocol", kProtocol},
                          {"version", 1},
                          {"capabilities", { {"eventStep", true},
                                              {"abort", true},
                                              {"telemetry", true} }}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "start") {
        const auto source = request.value("dsl", std::string{});
        const auto compiled = logicpilot::dsl::compile_source(source, "<session-host>");
        if (!compiled.ok) {
          json diagnostics = json::array();
          for (const auto& diagnostic : compiled.diagnostics) {
            diagnostics.push_back({{"code", diagnostic.code},
                                   {"message", diagnostic.message}});
          }
          std::cout << json{{"id", id}, {"ok", false}, {"diagnostics", diagnostics}}.dump()
                    << '\n'
                    << std::flush;
          continue;
        }
        logicpilot::SimulationKernel kernel;
        std::string error;
        const auto loaded = logicpilot::load_model_buffer(
            compiled.v2_bytes.data(), compiled.v2_bytes.size());
        if (!loaded.ok() || !kernel.load(loaded.file, &error)) {
          std::cout << error_response(id, error.empty() ? "model load failed" : error).dump()
                    << '\n'
                    << std::flush;
          continue;
        }
        session = kernel.create_session(&error);
        if (!session) {
          std::cout << error_response(id, error.empty() ? "session creation failed" : error).dump()
                    << '\n'
                    << std::flush;
          continue;
        }
        logicpilot::ReplicationConfig config;
        config.seed = request.value("seed", std::uint64_t{42});
        config.arrivals = request.value("arrivals", std::uint64_t{4000});
        config.warmup_arrivals = request.value("warmup", std::uint64_t{400});
        config.max_events = request.value("maxEvents", std::uint64_t{50'000'000});
        if (!session->start(config, &error)) {
          session.reset();
          std::cout << error_response(id, error).dump() << '\n' << std::flush;
          continue;
        }
        std::cout << json{{"id", id},
                          {"ok", true},
                          {"state", "running"},
                          {"simTimeNs", session->now().as_ns()},
                          {"pending", session->has_pending_events()},
                          {"telemetry", telemetry_json(*session)}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "step") {
        if (!session) throw std::runtime_error("no active session");
        std::size_t dispatched = 0;
        std::string error;
        if (!session->advance_events(request.value("events", std::size_t{1}),
                                     nullptr, nullptr, &error, &dispatched))
          throw std::runtime_error(error);
        std::cout << json{{"id", id},
                          {"ok", true},
                          {"dispatched", dispatched},
                          {"simTimeNs", session->now().as_ns()},
                          {"pending", session->has_pending_events()},
                          {"telemetry", telemetry_json(*session)}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "advance") {
        if (!session) throw std::runtime_error("no active session");
        std::size_t dispatched = 0;
        std::string error;
        if (!session->advance(logicpilot::SimTime::from_ns(until_ns(request)),
                              nullptr, nullptr, &error, &dispatched))
          throw std::runtime_error(error);
        std::cout << json{{"id", id},
                          {"ok", true},
                          {"dispatched", dispatched},
                          {"simTimeNs", session->now().as_ns()},
                          {"pending", session->has_pending_events()},
                          {"telemetry", telemetry_json(*session)}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "snapshot") {
        if (!session) throw std::runtime_error("no active session");
        std::cout << json{{"id", id},
                          {"ok", true},
                          {"active", session->active()},
                          {"simTimeNs", session->now().as_ns()},
                          {"pending", session->has_pending_events()}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "abort") {
        if (!session) throw std::runtime_error("no active session");
        std::string error;
        if (!session->abort(&error)) throw std::runtime_error(error);
        session.reset();
        std::cout << json{{"id", id}, {"ok", true}, {"state", "cancelled"}}.dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "finish") {
        if (!session) throw std::runtime_error("no active session");
        std::string error;
        const auto metrics = session->finish(nullptr, nullptr, &error);
        if (!error.empty()) throw std::runtime_error(error);
        session.reset();
        std::cout << json{{"id", id}, {"ok", true}, {"state", "completed"},
                          {"metrics", metrics_json(metrics)}}
                          .dump()
                  << '\n'
                  << std::flush;
      } else if (kind == "shutdown") {
        std::cout << json{{"id", id}, {"ok", true}}.dump() << '\n' << std::flush;
        break;
      } else {
        throw std::runtime_error("unknown session-host command");
      }
    } catch (const std::exception& error) {
      std::cout << error_response(id, error.what()).dump() << '\n' << std::flush;
    }
  }
  if (session && session->active()) session->abort();
  return 0;
}
