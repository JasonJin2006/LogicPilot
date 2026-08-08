// AnyLogic Queue contract: a full preempting queue always accepts a newcomer.
// A higher-priority arrival replaces the weakest established waiter, while a
// later lower-priority newcomer is itself routed through outPreempted.
model DesQueueTimeoutPreempt {
  use process

  resource TooSmall {
    capacity = 1
  }
  source Low {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 1
  }
  source High {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 5
  }
  source WeakNewcomer {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(100)
    firstArrivalMode = "at_time"
    firstArrivalTime = 0.5
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 0
  }
  queue Buffer {
    capacity = 1
    queuing = "queuing_priority"
    enablePreemption = true
    enableTimeout = true
    timeout = 1
  }
  service Blocked {
    resource = TooSmall
    numberOfUnits = 2
    queueCapacity = 0
    time = constant(1)
  }
  sink Done { }
  selectOutput PreemptedKind {
    condition = priority == 0
  }
  sink EstablishedPreempted { }
  sink NewcomerPreempted { }
  sink Late { }

  couple Low.out -> Buffer.in
  couple High.out -> Buffer.in
  couple WeakNewcomer.out -> Buffer.in
  couple Buffer.out -> Blocked.in
  couple Buffer.outPreempted -> PreemptedKind.in
  couple PreemptedKind.outT -> NewcomerPreempted.in
  couple PreemptedKind.outF -> EstablishedPreempted.in
  couple Buffer.outTimeout -> Late.in
  couple Blocked.out -> Done.in
}
