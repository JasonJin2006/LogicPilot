// Source behavior aligned with the AnyLogic Process Modeling Library:
// two arrival events, three jobs in each event, first event at model start.
model SourceArrivals {
  use process

  source Jobs {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(5)
    firstArrivalMode = "at_start"
    multipleEntitiesPerArrival = true
    agentsPerArrival = 3
    limitArrivals = true
    maxArrivals = 2
  }
  sink Done { }

  couple Jobs.out -> Done.in
}
