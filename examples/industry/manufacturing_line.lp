// Manufacturing line example (P3 industry models): raw parts arrive, go
// through a two-stage line (drilling pool of 2 machines, then assembly),
// and leave as finished goods. Demonstrates industry modeling with the
// process library (SemanticsRef registry): resource pools, finite buffers
// and multi-stage flows.
model ManufacturingLine {
  use process
  param arrival_rate: float = 0.5
  param drill_time: float = 1.0

  resource DrillPool {
    capacity = 2
    failure_rate = 0.02
  }
  resource Assembly {
    capacity = 1
  }

  source RawParts {
    arrival = rate(arrival_rate)
  }
  queue DrillBuffer {
    capacity = 50
  }
  service Drill {
    resource = DrillPool
    time = exponential(drill_time)
  }
  queue AssemblyBuffer {
    capacity = 20
  }
  service Assemble {
    resource = Assembly
    time = exponential(drill_time * 1.5)
  }
  sink FinishedGoods { }

  couple RawParts.out -> DrillBuffer.in
  couple DrillBuffer.out -> Drill.in
  couple Drill.out -> AssemblyBuffer.in
  couple AssemblyBuffer.out -> Assemble.in
  couple Assemble.out -> FinishedGoods.in
}
