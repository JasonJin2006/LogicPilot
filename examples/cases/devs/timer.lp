// Level 1 DEVS case: one autonomous atomic model. The timer performs one
// internal transition per simulated second and emits an unconnected tick.
model AtomicTimer {
  atomic Timer {
    time_advance = constant(1.0)
    on_timeout { emit tick }
  }
}
