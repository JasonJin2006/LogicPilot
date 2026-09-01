// Level 3 DEVS case: two imminent atoms emit at the same timestamp. PDEVS
// batches both messages for Relay in one external transition. This exercises
// simultaneous-event semantics without pretending that v0.1 supports
// Mealy-style output directly from an external transition.
model ParallelFanin {
  atomic SourceA {
    time_advance = constant(1.0)
    on_timeout { emit pulse }
  }

  atomic SourceB {
    time_advance = constant(1.0)
    on_timeout { emit pulse }
  }

  atomic Relay {
    state received = false
    time_advance = infinite
    on_input pulse { received = true }
  }

  couple SourceA.pulse -> Relay.pulse
  couple SourceB.pulse -> Relay.pulse
}
