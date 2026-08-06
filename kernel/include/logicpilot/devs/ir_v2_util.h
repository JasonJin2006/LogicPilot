// Shared read-only helpers over the v2 IR FlatBuffers view.
//
// Used by the IR loader (method resolution / flow parameter extraction) and
// by method runtimes that lower v2 nodes (e.g. the process method runtime).
// Keeping them in one header prevents the loader and the method libraries
// from drifting apart on parameter names and distribution semantics.
#pragma once

#include <cstddef>
#include <cstring>
#include <functional>
#include <string>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/mm1.h"

namespace logicpilot::ir_v2_util {

using ir::v2::Distribution;
using ir::v2::Node;
using ir::v2::Var;
using ir::v2::VarType_Bool;
using ir::v2::VarType_Distribution;
using ir::v2::VarType_Float;
using ir::v2::VarType_Int;
using ir::v2::VarType_String;

inline const char* node_library(const Node* node) {
  if (node != nullptr && node->semantics() != nullptr &&
      node->semantics()->library() != nullptr) {
    return node->semantics()->library()->c_str();
  }
  return "";
}

inline const char* node_block(const Node* node) {
  if (node != nullptr && node->semantics() != nullptr &&
      node->semantics()->block() != nullptr) {
    return node->semantics()->block()->c_str();
  }
  return "";
}

inline const char* node_name(const Node* node) {
  if (node != nullptr && node->metadata() != nullptr &&
      node->metadata()->name() != nullptr) {
    return node->metadata()->name()->c_str();
  }
  return "<unnamed>";
}

// Reads a typed block parameter by name from a v2 Node's `params` vector.
inline const Var* node_var(const Node* node, const char* name) {
  if (node == nullptr || node->params() == nullptr) {
    return nullptr;
  }
  for (const Var* var : *node->params()) {
    if (var != nullptr && var->name() != nullptr &&
        var->name()->str() == name) {
      return var;
    }
  }
  return nullptr;
}

inline double node_float_param(const Node* node, const char* name,
                               double fallback) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Float) {
    return var->float_value();
  }
  return fallback;
}

inline std::int64_t node_int_param(const Node* node, const char* name,
                                   std::int64_t fallback) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Int) {
    return var->int_value();
  }
  return fallback;
}

// Bool block parameters (`permanent`, `initiallyBlocked`, ...) lower to
// VarType_Bool; also accept int-typed values for robustness.
inline bool node_bool_param(const Node* node, const char* name,
                            bool fallback) {
  const Var* var = node_var(node, name);
  if (var == nullptr) {
    return fallback;
  }
  switch (var->type()) {
    case VarType_Bool:
      return var->bool_value();
    case VarType_Int:
      return var->int_value() != 0;
    default:
      return fallback;
  }
}

inline const char* node_string_param(const Node* node, const char* name) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_String &&
      var->string_value() != nullptr) {
    return var->string_value()->c_str();
  }
  return nullptr;
}

inline const Distribution* node_dist_param(const Node* node,
                                           const char* name) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Distribution) {
    return var->distribution();
  }
  return nullptr;
}

// Lower a v2 IR Distribution to a sampler. Poisson(rate) is treated as a
// Poisson arrival process, i.e. exponential(rate) inter-arrival times
// (dsl-spec v0 R8 semantics). Kind bytes mirror the v1 DistributionKind
// values: Constant=0, Uniform=1, Normal=2, Exponential=3, Poisson=4.
inline TimeSampler make_sampler(const Distribution* dist, std::string* error) {
  if (dist == nullptr) {
    if (error != nullptr) {
      *error = "missing distribution";
    }
    return nullptr;
  }
  const auto param = [&](std::size_t i, double fallback) {
    if (dist->params() != nullptr && i < dist->params()->size()) {
      return dist->params()->Get(static_cast<flatbuffers::uoffset_t>(i));
    }
    return fallback;
  };
  switch (dist->kind()) {
    case 0: {  // Constant
      const double value = param(0, 0.0);
      return [value](Xoshiro256PlusPlus&) { return value; };
    }
    case 1: {  // Uniform
      Uniform<Xoshiro256PlusPlus> uniform{param(0, 0.0), param(1, 1.0)};
      return [uniform](Xoshiro256PlusPlus& engine) mutable {
        return uniform(engine);
      };
    }
    case 2: {  // Normal
      Normal<Xoshiro256PlusPlus> normal{param(0, 0.0), param(1, 1.0)};
      return [normal](Xoshiro256PlusPlus& engine) mutable {
        return normal(engine);
      };
    }
    case 3: {  // Exponential
      Exponential<Xoshiro256PlusPlus> exponential{param(0, 1.0)};
      return [exponential](Xoshiro256PlusPlus& engine) mutable {
        return exponential(engine);
      };
    }
    case 4: {  // Poisson arrival process == exponential inter-arrivals
      Exponential<Xoshiro256PlusPlus> exponential{param(0, 1.0)};
      return [exponential](Xoshiro256PlusPlus& engine) mutable {
        return exponential(engine);
      };
    }
    default:
      if (error != nullptr) {
        *error = "unknown distribution kind";
      }
      return nullptr;
  }
}

// True when the node carries the given {library, block} semantics.
inline bool node_is(const Node* node, const char* library,
                    const char* block) {
  return node != nullptr && std::strcmp(node_library(node), library) == 0 &&
         std::strcmp(node_block(node), block) == 0;
}

}  // namespace logicpilot::ir_v2_util
