// Seized resource units honor the pool's busy-time failure law: while a
// unit is held by Seize, the pool may fail (exponential time-to-failure)
// and become unavailable until repaired; availability reflects the downtime.
model SeizeFailure {
  resource Server {
    capacity = 1
    failure_rate = 0.1
    repair_rate = 1.0
  }
  source Jobs {
    arrival = rate(1.0)
  }
  queue Buffer {
    capacity = 100
  }
  seize Grab {
    resource = Server
    numberOfUnits = 1
  }
  delay Work {
    delayTime = constant(0.5)
    capacity = 1
  }
  release Drop {
  }
  sink Done {
  }
  couple Jobs.out -> Buffer.in
  couple Buffer.out -> Grab.in
  couple Grab.out -> Work.in
  couple Work.out -> Drop.in
  couple Drop.out -> Done.in
}
