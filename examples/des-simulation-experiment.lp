// Reproducible DES simulation experiment. The experiment owns the random
// seed and replication count; termination/warm-up remain per-run settings.
model DesSimulationExperiment {
  use process

  resource Server { capacity = 1 }
  source Arrivals { arrival = rate(0.8) }
  queue Waiting { capacity = 100 }
  service Handle { resource = Server time = exponential(1.0) }
  sink Done { }

  couple Arrivals.out -> Waiting.in
  couple Waiting.out -> Handle.in
  couple Handle.out -> Done.in

  experiment Baseline {
    type = simulation
    replications = 4
    seed = 7
  }

  // AnyLogic-style unique seed plus varying replications. The runner always
  // executes the minimum, then stops when the Wq CI relative half-width is
  // within error_percent, or at max_replications.
  experiment Adaptive {
    type = simulation
    seed_mode = random
    replication_mode = precision
    min_replications = 2
    max_replications = 8
    confidence = 0.95
    error_percent = 1000000
    metric = Wq
  }
}
