// DES resource workflow: Seize acquires units from a ResourcePool, the
// agent holds them through the delay, and Release returns them.
model SeizeRelease {
  resource Server {
    capacity = 2
  }
  source Jobs {
    arrival = rate(4.0)
  }
  queue Buffer {
    capacity = 100
  }
  seize Grab {
    resource = Server
    numberOfUnits = 1
  }
  delay Work {
    delayTime = exponential(1.0)
    capacity = 100
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
