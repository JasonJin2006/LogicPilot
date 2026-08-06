// DES composition showcase: a small shop flow exercising attributes,
// priority queue, seize with a failing pool, temporary batch/unbatch,
// attribute-based routing, TimeMeasure and Exit in one model.
model DesShop {
  resource Machine {
    capacity = 2
    failure_rate = 0.02
    repair_rate = 1.0
  }
  source Jobs {
    arrival = rate(1.0)
    state priority: float = 3
  }
  queue Buffer {
    capacity = 100
    queuing = queuing_priority
  }
  seize Grab {
    resource = Machine
    numberOfUnits = 1
  }
  batch Group {
    batchSize = 2
    permanent = false
  }
  delay Machining {
    delayTime = constant(1.0)
    capacity = 10
  }
  unbatch Split {
  }
  selectOutput Route {
    condition = priority >= 2
  }
  timeMeasureStart T0 {
  }
  delay Finish {
    delayTime = constant(0.5)
    capacity = 10
  }
  timeMeasureEnd T1 {
  }
  release Drop {
  }
  exit Done {
  }
  couple Jobs.out -> Buffer.in
  couple Buffer.out -> Grab.in
  couple Grab.out -> Group.in
  couple Group.out -> Machining.in
  couple Machining.out -> Split.in
  couple Split.out -> Route.in
  couple Route.outT -> T0.in
  couple Route.outF -> T0.in
  couple T0.out -> Finish.in
  couple Finish.out -> T1.in
  couple T1.out -> Drop.in
  couple Drop.out -> Done.in
}
