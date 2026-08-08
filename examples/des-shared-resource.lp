// AnyLogic ResourcePool contract: requests from different Service blocks
// arbitrate the same pool instead of receiving independent copies.
model DesSharedResource {
  use process

  resource Shared {
    capacity = 1
  }
  source InA {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 1
  }
  source InB {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 1
  }
  service WorkA {
    resource = Shared
    numberOfUnits = 1
    queueCapacity = 1
    time = constant(1)
  }
  service WorkB {
    resource = Shared
    numberOfUnits = 1
    queueCapacity = 1
    time = constant(1)
  }
  sink DoneA { }
  sink DoneB { }

  couple InA.out -> WorkA.in
  couple InB.out -> WorkB.in
  couple WorkA.out -> DoneA.in
  couple WorkB.out -> DoneB.in
}
