// ABM swarm example - milestone 1c.
//
// Three agents start at x = {1/6, 3/6, 5/6} with distinct drift velocities;
// the `bounce` behavior keeps them inside [0,1]^2. Every tick, `flip active`
// toggles the bool state on every agent, so after an odd tick budget each
// agent's `active` is false. The DEVS replication adapter treats --arrivals
// as the tick budget (deterministic, no RNG).
model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick flip active
    on_tick bounce
  }
}
