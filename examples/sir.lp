// SIR epidemic model - coupled ODE system (Phase D extension).
//
//   dS/dt = -beta*S*I
//   dI/dt =  beta*S*I - gamma*I
//   dR/dt =  gamma*I
// Population is conserved: S + I + R = 1 at every instant (the RK4
// integrator evaluates all equations against the shared state at each stage).
model SIR {
  continuous Dynamics {
    state S = 0.99
    state I = 0.01
    state R = 0.0
    param beta = 0.5
    param gamma = 0.1
    d S/dt = -beta*S*I
    d I/dt = beta*S*I - gamma*I
    d R/dt = gamma*I
  }
}
