// Assembler (AnyLogic): waits for the kit (in) plus the required number of
// parts (p1, quantity125), assembles for delayTime seconds, then outputs.
model AssemblerLine {
  source Kits {
    arrival = rate(1.0)
  }
  source Parts {
    arrival = rate(2.0)
  }
  assembler Build {
    quantity125 = 2
    delayTime = 2.0
  }
  sink Done {
  }
  couple Kits.out -> Build.in
  couple Parts.out -> Build.p1
  couple Build.out -> Done.in
}
