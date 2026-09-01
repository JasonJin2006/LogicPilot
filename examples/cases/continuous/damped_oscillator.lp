// Level 3 Continuous case: coupled second-order dynamics, integrated with
// adaptive RK4 and zero-crossing observation over a fixed 20 s horizon.
model DampedOscillator {
  continuous Dynamics {
    state x = 1.0
    state v = 0.0
    param omega = 2.0
    param damping = 0.15

    param adaptive = 1
    param absolute_tolerance = 0.000000001
    param relative_tolerance = 0.0000001
    param minimum_step = 0.000001
    param maximum_step = 0.1
    param horizon = 20.0
    param detect_zero_crossings = 1

    d x/dt = v
    d v/dt = -2*damping*v - omega*omega*x
  }
}
