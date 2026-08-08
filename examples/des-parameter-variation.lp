// Two-dimensional DES parameter variation: 2 arrival rates x 2 capacities.
model DesParameterVariation {
  use process

  param arrival_rate: float = 0.6
  param server_count: int = 1

  resource Server { capacity = server_count }
  source Arrivals { arrival = rate(arrival_rate) }
  queue Waiting { capacity = 100 }
  service Handle { resource = Server time = exponential(1.0) }
  sink Done { }

  couple Arrivals.out -> Waiting.in
  couple Waiting.out -> Handle.in
  couple Handle.out -> Done.in

  experiment CapacityStudy {
    type = parameter_variation
    metric = Wq
    seed_mode = fixed
    seed = 42
    replication_mode = fixed
    replications = 2

    axis ArrivalRate {
      variable = arrival_rate
      range = 0.6..0.8
      step = 0.2
    }
    axis Servers {
      variable = server_count
      range = 1..2
      step = 1
    }
  }
}
