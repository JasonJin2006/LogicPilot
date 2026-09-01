// Level 3 Agent case: a population large enough to enter the deterministic
// parallel tick path. Every vehicle owns typed state, moves in continuous
// 2-D space, flips its activity flag and reflects at the unit-square bounds.
model FleetParallel {
  agent Vehicle {
    count = 65536
    state active = true
    state generation: int = 1
    on_tick { flip active; bounce }
  }
}
