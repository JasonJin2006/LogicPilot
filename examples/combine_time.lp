// Combine synchronizes the two streams; TimeMeasureStart/End measure the
// time spent in the delay between the marker blocks.
model CombineTime {
  source A {
    arrival = rate(1.0)
  }
  source B {
    arrival = rate(1.0)
  }
  combine Join {
  }
  timeMeasureStart T0 {
  }
  delay Work {
    delayTime = constant(0.5)
    capacity = 100
  }
  timeMeasureEnd T1 {
  }
  sink Done {
  }
  couple A.out -> Join.in1
  couple B.out -> Join.in2
  couple Join.out -> T0.in
  couple T0.out -> Work.in
  couple Work.out -> T1.in
  couple T1.out -> Done.in
}
