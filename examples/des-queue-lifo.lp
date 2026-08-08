// Same arrivals as des-queue-fifo.lp, but LIFO serves High first and Low
// times out. The differentiated sinks make the ordering externally visible.
model DesQueueLifo {
  use process

  resource Server { capacity = 1 }
  source Blocker {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_start"
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 0
  }
  source Low {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_time"
    firstArrivalTime = 0.1
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 1
  }
  source High {
    arrivalType = "interarrival_time"
    interarrivalTime = constant(1)
    firstArrivalMode = "at_time"
    firstArrivalTime = 0.2
    limitArrivals = true
    maxArrivals = 1
    state priority: float = 5
  }
  queue Buffer {
    capacity = 2
    queuing = "queuing_lifo"
    enableTimeout = true
    timeout = 1
  }
  service Work {
    resource = Server
    queueCapacity = 0
    time = constant(1)
  }
  selectOutput ServedRoute { condition = priority > 3 }
  selectOutput TimeoutRoute { condition = priority > 3 }
  sink OtherServed { }
  sink HighServed { }
  sink LowTimedOut { }
  sink HighTimedOut { }

  couple Blocker.out -> Work.in
  couple Low.out -> Buffer.in
  couple High.out -> Buffer.in
  couple Buffer.out -> Work.in
  couple Work.out -> ServedRoute.in
  couple ServedRoute.outT -> HighServed.in
  couple ServedRoute.outF -> OtherServed.in
  couple Buffer.outTimeout -> TimeoutRoute.in
  couple TimeoutRoute.outT -> HighTimedOut.in
  couple TimeoutRoute.outF -> LowTimedOut.in
}
