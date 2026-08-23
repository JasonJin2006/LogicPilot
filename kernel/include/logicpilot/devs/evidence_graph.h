// Deterministic causal graph summary derived from DEVS evidence records.
#pragma once

#include <algorithm>
#include <cstdint>
#include <map>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/devs/evidence.h"

namespace logicpilot {

struct DevsEvidenceEdge {
  std::uint32_t source{kExternalEvidenceSource};
  std::uint32_t target{0};
  std::string source_path;
  std::string target_path;
  std::uint64_t messages{0};
  std::uint64_t transitions{0};

  bool operator==(const DevsEvidenceEdge&) const = default;
};

class DevsEvidenceGraph {
 public:
  static bool build(std::span<const DevsEvidenceRecord> records,
                    DevsEvidenceGraph& graph, std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    graph.edges_.clear();
    std::map<std::uint32_t, std::string> paths;
    std::map<std::pair<std::uint32_t, std::uint32_t>, DevsEvidenceEdge> edges;
    for (const DevsEvidenceRecord& record : records) {
      if (record.inputs.size() != record.input_sources.size()) {
        if (error != nullptr) *error = "evidence input/source cardinality mismatch";
        return false;
      }
      paths.emplace(record.atom, record.atom_path);
      std::map<std::uint32_t, bool> seen_sources;
      for (std::size_t index = 0; index < record.inputs.size(); ++index) {
        const std::uint32_t source = record.input_sources[index];
        const auto key = std::make_pair(source, record.atom);
        auto [it, inserted] = edges.try_emplace(
            key, DevsEvidenceEdge{source, record.atom, {}, record.atom_path, 0, 0});
        if (inserted) {
          const auto source_path = paths.find(source);
          if (source_path != paths.end()) it->second.source_path = source_path->second;
        }
        ++it->second.messages;
        if (seen_sources.emplace(source, true).second) ++it->second.transitions;
      }
    }
    for (auto& [key, edge] : edges) {
      const auto source_path = paths.find(key.first);
      if (source_path != paths.end()) edge.source_path = source_path->second;
      const auto target_path = paths.find(key.second);
      if (target_path != paths.end()) edge.target_path = target_path->second;
      graph.edges_.push_back(std::move(edge));
    }
    return true;
  }

  [[nodiscard]] static DevsEvidenceGraph build(
      std::span<const DevsEvidenceRecord> records) {
    DevsEvidenceGraph graph;
    (void)build(records, graph, nullptr);
    return graph;
  }

  [[nodiscard]] const std::vector<DevsEvidenceEdge>& edges() const { return edges_; }

  // Stable FNV-1a over the sorted edge summary, suitable for comparing causal
  // topology across sequential/parallel executions.
  [[nodiscard]] std::uint64_t hash() const {
    std::uint64_t value = 0xCBF29CE484222325ULL;
    const auto absorb = [&](std::uint64_t scalar) {
      for (int byte = 0; byte < 8; ++byte) {
        value ^= (scalar >> (byte * 8)) & 0xFFU;
        value *= 0x100000001B3ULL;
      }
    };
    const auto absorb_string = [&](const std::string& text) {
      absorb(text.size());
      for (const unsigned char byte : text) {
        value ^= byte;
        value *= 0x100000001B3ULL;
      }
    };
    absorb(edges_.size());
    for (const DevsEvidenceEdge& edge : edges_) {
      absorb(edge.source);
      absorb(edge.target);
      absorb_string(edge.source_path);
      absorb_string(edge.target_path);
      absorb(edge.messages);
      absorb(edge.transitions);
    }
    return value;
  }

 private:
  std::vector<DevsEvidenceEdge> edges_;
};

}  // namespace logicpilot
