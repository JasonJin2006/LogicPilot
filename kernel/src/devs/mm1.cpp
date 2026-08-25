// M/M/1 reference model (ADR-0068): a thin configuration of the shared
// QueueingFlowSim engine. Tests and benchmarks consume it as a deterministic
// workload fixture - it is not part of any shipped driver surface.
#include "logicpilot/devs/mm1.h"

#include "logicpilot/core/random/distributions.h"

namespace logicpilot {

Mm1Simulator::Mm1Simulator(Mm1Params params)
    : QueueingFlowSim{[&] {
        QueueingFlowSpec spec;
        const double lambda = params.lambda;
        const double mu = params.mu;
        spec.interarrival = [lambda](Xoshiro256PlusPlus& engine) {
          Exponential<Xoshiro256PlusPlus> dist{lambda};
          return dist(engine);
        };
        spec.service = [mu](Xoshiro256PlusPlus& engine) {
          Exponential<Xoshiro256PlusPlus> dist{mu};
          return dist(engine);
        };
        return spec;
      }()},
      params_{params} {}

}  // namespace logicpilot
