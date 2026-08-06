// Assembler (AnyLogic): waits for the kit (in) plus the required number of
// parts (p1, quantity125), seizes an assembly unit, assembles for delayTime
// seconds, then outputs and releases the unit.
model AssemblerLine {
  resource Server {
    capacity = 1
  }
  source Kits {
    arrival = rate(1.0)
  }
  source Parts {
    arrival = rate(2.0)
  }
  assembler Build {
    quantity125 = 2
    delayTime = 2.0
    resourcePool = Server
    numberOfUnits = 1
  }
  sink Done {
  }
  couple Kits.out -> Build.in
  couple Parts.out -> Build.p1
  couple Build.out -> Done.in
}
