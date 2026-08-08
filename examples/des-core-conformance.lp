// Deterministic DES acceptance model derived from the AnyLogic Process
// Modeling Library contracts for Source, Service, ResourcePool and Sink.
// Four jobs need two units each from a four-unit pool, so Service may run
// exactly two jobs concurrently.
model DesCoreConformance {
  use process

  resource Workers {
    capacity = 4
  }
  source Jobs {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(0.1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 4
  }
  service Work {
    resource = Workers
    numberOfUnits = 2
    queueCapacity = 4
    time = constant(1.0)
  }
  sink Done { }

  couple Jobs.out -> Work.in
  couple Work.out -> Done.in
}
